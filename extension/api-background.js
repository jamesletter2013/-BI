(() => {
  const ORIGIN = 'https://taoa-competitor-lab.jamesletter2013.chatgpt.site';
  const STORE = 'taoaBackgroundAnalysisV1', ALARM = 'taoa-ai-deadline';
  const profiles = TAOAPROFILES.create(chrome.storage);
  let queue = Promise.resolve();
  const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  const isSettings = s => s.id === chrome.runtime.id && s.url === chrome.runtime.getURL('api-settings.html') && (s.frameId == null || s.frameId === 0);
  const isInternal = s => s.id === chrome.runtime.id && !s.tab && s.url === chrome.runtime.getURL('offscreen.html');
  const isPage = s => s.id === chrome.runtime.id && s.frameId === 0 && s.tab?.id != null && (() => {
    try { return new URL(s.url).origin === ORIGIN && new URL(s.tab.url).origin === ORIGIN; } catch { return false; }
  })();
  const read = async () => (await chrome.storage.session.get(STORE))[STORE] || { jobs: [], seen: [] };
  const save = state => chrome.storage.session.set({ [STORE]: state });
  const active = job => job?.status === 'running';
  const summary = ({ input, status, stage, createdAt, finishedAt, publicConfig }) => ({
    requestId: input.requestId, itemId: input.itemId, status, stage, createdAt, finishedAt,
    profileName: publicConfig.name, model: publicConfig.model,
  });
  const notify = async (job, event) => {
    try { await chrome.tabs.sendMessage(job.tabId, { type: 'TAOA_PERSONAL_EVENT', requestId: job.input.requestId, event },
      job.documentId ? { documentId: job.documentId } : { frameId: 0 }); } catch { /* Reopening reads the saved task. */ }
  };
  async function finish(state, job, event) {
    job.status = event.type === 'result' ? 'success' : 'failed';
    job.finishedAt = Date.now(); job.event = event;
    await save(state); // Save before delivery: closing a tab must not lose the result.
    await chrome.alarms.clear(ALARM);
    await notify(job, event);
  }
  async function reconcile(state) {
    const job = state.jobs.find(active);
    if (!job) return;
    let response;
    try { response = await chrome.runtime.sendMessage({ type: 'TAOA_AI_OFFSCREEN_STATE', requestId: job.input.requestId }); } catch {}
    if (Date.now() >= job.deadline || !response?.active) {
      await chrome.runtime.sendMessage({ type: 'TAOA_AI_OFFSCREEN_ABORT', requestId: job.input.requestId }).catch(() => {});
      await finish(state, job, { type: 'error', message: '后台任务已超时或执行环境中断；服务商可能已计费。不会自动重发，请核对后再决定。' });
    }
  }
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (!m?.type?.startsWith('TAOA_PERSONAL_') || m.type === 'TAOA_PERSONAL_EVENT') return false;
    const run = async () => {
      const state = await read();
      if (m.type === 'TAOA_PERSONAL_OFFSCREEN_CLAIM') {
        if (!isInternal(sender)) throw new Error('只允许插件内部执行。');
        const job = state.jobs.find(j => j.input.requestId === m.requestId);
        if (!active(job) || job.claimedAt || Date.now() > job.deadline) throw new Error('任务已领取、取消或超时，禁止重复调用。');
        const config = await profiles.resolve(job.profileId, job.revision);
        const url = new URL(TAOAAPI.endpoint(config));
        if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw new Error('接口域名权限已撤销。');
        job.claimedAt = Date.now(); await save(state);
        // Only the verified offscreen caller receives the key; never broadcast it.
        return { ok: true, input: job.input, config };
      }
      if (m.type === 'TAOA_PERSONAL_OFFSCREEN_EVENT') {
        if (!isInternal(sender)) throw new Error('只允许插件内部执行。');
        const job = state.jobs.find(j => j.input.requestId === m.requestId);
        if (!active(job)) return { ok: true }; // Ignore late events after an explicit cancel.
        const event = m.event;
        if (event?.type === 'progress' && ['requesting', 'organizing'].includes(event.stage)) {
          job.stage = event.stage; await save(state); await notify(job, event);
        } else if (event?.type === 'result') {
          try {
            const text = TAOAAPI.validateSuggestions(event.result?.text, job.input.itemId);
            const token = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
            const result = { requestId: job.input.requestId, itemId: job.input.itemId, text,
              provider: job.publicConfig.name + ' · ' + job.publicConfig.host, model: job.publicConfig.model,
              usage: { inputTokens: token(event.result?.usage?.inputTokens), outputTokens: token(event.result?.usage?.outputTokens) },
              notice: '使用所选个人 API；结果保留在本次浏览器会话，结论需人工核实。' };
            await finish(state, job, { type: 'result', result });
          } catch {
            await finish(state, job, { type: 'error', message: 'AI 已返回，但建议格式不完整，未替换左侧建议；服务商可能已计费，不自动重试。' });
          }
        } else if (event?.type === 'error') {
          await finish(state, job, { type: 'error', message: typeof event.message === 'string' ? event.message.slice(0, 500) : '后台分析失败，不自动重试。' });
        } else throw new Error('无效的任务进度。');
        return { ok: true };
      }
      if (m.type === 'TAOA_PERSONAL_PROFILES') {
        if (!isSettings(sender)) throw new Error('只能在插件设置页管理 API。');
        if (m.action === 'list') return { ok: true, profiles: await profiles.list() };
        await reconcile(state);
        if (state.jobs.some(j => active(j) && j.profileId === m.profile?.id)) throw new Error('这套 API 正在后台分析，请完成或取消后再修改。');
        if (m.action === 'save') {
          const url = new URL(TAOAAPI.endpoint(m.profile));
          if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw new Error('请先授权此接口域名。');
          return { ok: true, profile: await profiles.save(m.profile) };
        }
        if (m.action === 'delete' || m.action === 'clear') {
          await profiles.remove(m.profile.id, m.profile.revision, m.action === 'clear'); return { ok: true };
        }
        if (m.action === 'revokeConsent') {
          await profiles.setConsent(m.profile.id, m.profile.revision, false); return { ok: true };
        }
        throw new Error('不支持的配置操作。');
      }
      if (!isPage(sender)) throw new Error('只允许从指定工作台顶层页面发起。');
      if (m.type === 'TAOA_PERSONAL_SETTINGS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
      await reconcile(state);
      if (m.type === 'TAOA_PERSONAL_STATUS') {
        const list = await profiles.list();
        return { ok: true, status: { installed: true, version: 4, profiles: list.map(({ baseUrl, ...p }) => p), jobs: state.jobs.map(summary) } };
      }
      if (m.type === 'TAOA_PERSONAL_JOB') {
        const job = state.jobs.find(j => j.input.requestId === m.requestId);
        if (!job) throw new Error('本次浏览器会话中没有此任务；不会重新调用 API。');
        return { ok: true, job: { ...summary(job), input: job.input, event: job.event } };
      }
      if (m.type === 'TAOA_PERSONAL_CANCEL') {
        const job = state.jobs.find(j => j.input.requestId === m.requestId);
        if (active(job)) {
          await chrome.runtime.sendMessage({ type: 'TAOA_AI_OFFSCREEN_ABORT', requestId: m.requestId }).catch(() => {});
          await finish(state, job, { type: 'error', message: '已主动停止等待；若已发送，服务商可能已计费。不会自动重试。' });
        }
        return { ok: true };
      }
      if (m.type !== 'TAOA_PERSONAL_START') throw new Error('不支持的操作。');
      const input = TAOAAPI.validateInput(m.input);
      if (state.seen.includes(input.requestId)) throw new Error('该任务已提交，请查看后台记录，不要重复调用。');
      if (state.jobs.some(active)) throw new Error('已有个人 API 在后台分析，请先查看、完成或取消。');
      if ((await chrome.storage.session.get('taoaPersonalJob')).taoaPersonalJob) throw new Error('旧版任务尚未结束，请先完成旧任务再更新插件。');
      const c = await profiles.resolve(m.profileId, m.revision);
      if (!c.consentGranted && m.confirmed !== true) throw new Error('这套 API 尚未授权发送资料和承担费用，请刷新工作台并完成首次确认。');
      TAOAAPI.checkCompatibility(c); // Reject known configuration mistakes before creating a job or paid request.
      const url = new URL(TAOAAPI.endpoint(c));
      if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] })) throw new Error('尚未授权此接口域名，请打开个人 API 设置重新保存。');
      await ensureOffscreenDocument();
      if (!c.consentGranted) await profiles.setConsent(c.id, c.revision, true);
      const job = { input, tabId: sender.tab.id, documentId: sender.documentId, profileId: c.id, revision: c.revision,
        createdAt: Date.now(), deadline: Date.now() + 210000, status: 'running', stage: 'requesting',
        publicConfig: { name: c.name, host: url.host, model: c.model, protocol: c.protocol } };
      state.jobs = [job, ...state.jobs].slice(0, 10); state.seen.push(input.requestId);
      await save(state); // Reserve the ID before dispatch; no key stored here.
      await chrome.alarms.create(ALARM, { when: job.deadline });
      try {
        const response = await chrome.runtime.sendMessage({ type: 'TAOA_AI_OFFSCREEN_START', requestId: input.requestId });
        if (!response?.ok) throw new Error();
      } catch {
        await finish(state, job, { type: 'error', message: '插件后台执行器未启动。未自动重试，请刷新连接后检查任务记录。' });
        throw new Error(job.event.message);
      }
      return { ok: true };
    };
    serial(run).then(respond).catch(error => respond({ ok: false, error: error.message || '个人 API 操作失败。' }));
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) void serial(async () => { const state = await read(); await reconcile(state); }).catch(() => {});
  });
  // Workbench tabs are viewers, not executors. Closing them never cancels a job.
})();

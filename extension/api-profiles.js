// Native extension contexts only. Metadata survives restarts; keys never go to local/sync.
globalThis.TAOAPROFILES = (() => {
  const META='taoaApiProfilesV2', KEYS='taoaApiKeysV2';
  // Device-local authorization, bound to this profile's exact destination and cost settings.
  const consentBinding=p=>JSON.stringify([1,p.id,TAOAAPI.endpoint(p),p.protocol,p.model,p.maxTokens,TAOAAPI.thinkingMode(p)]);
  const hasConsent=p=>p.consentBinding===consentBinding(p);
  function create(storage) {
    let ready;
    const initialize=()=>ready ||= (async()=>{
      await storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
      const local=await storage.local.get([META,'taoaPersonalApiPreferences']);
      if(local[META]?.version===2)return;
      const session=await storage.session.get('taoaPersonalApi');
      const old=session.taoaPersonalApi||local.taoaPersonalApiPreferences;
      const profiles=[],keys={};
      if(old){
        const c=TAOAAPI.settings(old),id='legacy-personal-api';
        c.revision=c.revision||crypto.randomUUID();
        profiles.push({...c,id,name:'原有 API'});
        if(session.taoaPersonalApi?.key)keys[id]={key:session.taoaPersonalApi.key,revision:c.revision};
      }
      await storage.session.set({[KEYS]:keys});
      await storage.local.set({[META]:{version:2,profiles}});
      await storage.session.remove('taoaPersonalApi');
      await storage.local.remove('taoaPersonalApiPreferences');
    })().catch(error=>{ready=null;throw error;});
    async function state(){
      await initialize();
      const local=await storage.local.get(META),session=await storage.session.get(KEYS);
      return {profiles:local[META]?.profiles||[],keys:session[KEYS]||{}};
    }
    function publicProfile(p,keys){
      return {id:p.id,name:p.name,protocol:p.protocol,baseUrl:p.baseUrl,model:p.model,maxTokens:p.maxTokens,revision:p.revision,
        host:new URL(TAOAAPI.endpoint(p)).host,thinking:TAOAAPI.thinkingMode(p),consentGranted:hasConsent(p),configured:!!keys[p.id]?.key && keys[p.id].revision===p.revision};
    }
    async function list(){const s=await state();return s.profiles.map(p=>publicProfile(p,s.keys));}
    async function resolve(id,revision){
      const s=await state(),p=s.profiles.find(p=>p.id===id);
      if(!p || p.revision!==revision)throw new Error('所选 API 已修改或删除，请刷新配置并重新选择。');
      const k=s.keys[id];if(!k?.key || k.revision!==revision)throw new Error('这套 API 尚未填写本次会话密钥。不会改用其他账户。');
      return {...p,consentGranted:hasConsent(p),key:k.key};
    }
    async function write(profiles,keys,oldKeys){
      await storage.session.set({[KEYS]:keys});
      try{await storage.local.set({[META]:{version:2,profiles}});}
      catch(error){await storage.session.set({[KEYS]:oldKeys});throw error;}
    }
    async function save(value){
      const s=await state(),old=value.id?s.profiles.find(p=>p.id===value.id):null;
      if(value.id && (!old || old.revision!==value.revision))throw new Error('此配置已在其他窗口修改，请重新选择后编辑。');
      const name=String(value.name||'').trim();
      if(!name || name.length>60)throw new Error('请给这套 API 填写一个名称（最多 60 字）。');
      if(s.profiles.some(p=>p.id!==old?.id && p.name===name))throw new Error('此名称已存在，请换一个方便区分的名称。');
      const config=TAOAAPI.settings(value),id=old?.id||crypto.randomUUID();
      if(!old && s.profiles.length>=100)throw new Error('最多保存 100 套配置，请先删除不用的配置。');
      const key=String(value.key||'').trim();
      const oldKey=old && s.keys[id]?.revision===old.revision?s.keys[id]?.key:'';
      const sameOrigin=old && new URL(TAOAAPI.endpoint(old)).origin===new URL(TAOAAPI.endpoint(config)).origin;
      if(oldKey && !sameOrigin && !key)throw new Error('更换域名必须重新填写密钥，不会将旧密钥转给新域名。');
      const nextKey=key||(sameOrigin?oldKey:'')||'';
      if(nextKey)TAOAAPI.buildRequest(config,nextKey,[{role:'user',content:'validate'}]);
      const p={...config,id,name,revision:crypto.randomUUID()},keys={...s.keys};
      if(old && hasConsent(old) && consentBinding(old)===consentBinding(p))p.consentBinding=old.consentBinding;
      delete keys[id];if(nextKey)keys[id]={key:nextKey,revision:p.revision};
      const profiles=old?s.profiles.map(row=>row.id===id?p:row):[...s.profiles,p];
      await write(profiles,keys,s.keys);return publicProfile(p,keys);
    }
    async function remove(id,revision,onlyKey=false){
      const s=await state(),old=s.profiles.find(p=>p.id===id);
      if(!old || old.revision!==revision)throw new Error('此配置已变更，请重新选择后操作。');
      const keys={...s.keys};delete keys[id];
      const profiles=onlyKey?s.profiles.map(p=>p.id===id?{...p,consentBinding:null,revision:crypto.randomUUID()}:p):s.profiles.filter(p=>p.id!==id);
      await write(profiles,keys,s.keys);
    }
    async function setConsent(id,revision,granted){
      const s=await state(),p=s.profiles.find(p=>p.id===id);
      if(!p || p.revision!==revision)throw new Error('配置已变化，请刷新后重新确认。');
      p.consentBinding=granted?consentBinding(p):null;
      await storage.local.set({[META]:{version:2,profiles:s.profiles}});
    }
    return {list,resolve,save,remove,setConsent};
  }
  return {create};
})();

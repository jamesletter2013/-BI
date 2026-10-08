// Register the UI only. Opening DevTools does not start collection.
if (chrome.devtools?.panels) chrome.devtools.panels.create('淘啊诊断', 'icons/icon32.png', 'load-diagnostics.html', () => {});

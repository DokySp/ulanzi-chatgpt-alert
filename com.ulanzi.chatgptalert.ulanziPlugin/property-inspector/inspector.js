(() => {
  const query = new URLSearchParams(location.search);
  const effect = document.getElementById('effect');
  const target = {
    uuid: query.get('uuid') || 'com.ulanzi.ulanzistudio.chatgptalert.alert',
    key: query.get('key') || '',
    actionid: query.get('actionid') || ''
  };
  let settings = {};
  const socket = new WebSocket('ws://' + (query.get('address') || '127.0.0.1')
    + ':' + (query.get('port') || '3906'));
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ ...target, cmd: 'connected', code: 0 }));
  });
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || !['add', 'paramfromapp', 'didReceiveSettings'].includes(message.cmd)) return;
    if (message.uuid !== target.uuid) return;
    target.key = message.key ?? target.key;
    target.actionid = message.actionid ?? target.actionid;
    const value = message.param ?? message.settings;
    if (value && typeof value === 'object') settings = value;
    effect.value = settings.effect === 'fade' ? 'fade' : 'blink';
    effect.disabled = !target.key || !target.actionid;
  });
  socket.addEventListener('close', () => { effect.disabled = true; });
  effect.addEventListener('change', () => {
    if (socket.readyState !== 1 || !target.key || !target.actionid) return;
    settings = { ...settings, effect: effect.value === 'fade' ? 'fade' : 'blink' };
    socket.send(JSON.stringify({ ...target, cmd: 'paramfromplugin', param: settings }));
  });
})();

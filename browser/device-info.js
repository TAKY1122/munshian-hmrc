// Collects the browser details HMRC asks for in its fraud prevention headers
// and sends them to the server before the user signs in.
(function () {
  var data = {
    timezoneOffset: new Date().getTimezoneOffset(),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      'scaling-factor': window.devicePixelRatio || 1,
      'colour-depth': window.screen.colorDepth,
    },
    window: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
    doNotTrack: navigator.doNotTrack === '1' || window.doNotTrack === '1',
  };
  fetch('/device-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
})();

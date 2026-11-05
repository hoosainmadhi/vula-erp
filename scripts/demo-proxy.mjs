import http from 'node:http';

const routes = {
  'africcoach.localhost': 3291,
  'jabulani-boards.localhost': 3292,
};

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  const port = routes[host];
  if (!port) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`Unknown demo host: ${host}`);
    return;
  }

  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Demo backend unavailable');
  });

  req.pipe(upstream);
});

server.listen(3290, () => {
  console.log(
    'Demo proxy listening on http://africcoach.localhost:3290 and http://jabulani-boards.localhost:3290',
  );
});

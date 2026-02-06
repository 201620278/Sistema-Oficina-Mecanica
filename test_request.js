const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/financeiro',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log('Data:', chunk.toString());
  });
  res.on('end', () => {
    console.log('End of response');
  });
});

req.on('error', (e) => {
  console.error('Error:', e);
});

req.end();
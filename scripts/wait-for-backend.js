'use strict';

const http = require('node:http');

const port = Number(process.env.PORT) || 3000;
const timeoutMs = 30_000;
const retryDelayMs = 200;
const startedAt = Date.now();

function waitForBackend() {
  const request = http.get({
    hostname: '127.0.0.1',
    port,
    path: '/api/status',
    timeout: 1_000
  }, (response) => {
    response.resume();
    console.log(`Backend disponivel na porta ${port}. Iniciando o Vite...`);
  });

  request.on('timeout', () => request.destroy());
  request.on('error', retryOrFail);
}

function retryOrFail() {
  if (Date.now() - startedAt >= timeoutMs) {
    console.error(`Backend nao ficou disponivel na porta ${port} em ${timeoutMs / 1_000}s.`);
    process.exitCode = 1;
    return;
  }

  setTimeout(waitForBackend, retryDelayMs);
}

waitForBackend();

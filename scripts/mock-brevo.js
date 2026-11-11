'use strict';

// A stand-in for the Brevo email API, used for local development and tests.
// It never sends mail. Change how it answers with:  GET /__mode?mode=ok|fail|timeout|unreadable
const http = require('node:http');

function createMockBrevo() {
    let mode = 'ok';
    let counter = 0;
    const messages = [];

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/__mode') {
            if (url.searchParams.get('mode')) mode = url.searchParams.get('mode');
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ mode }));
        }
        if (url.pathname === '/__messages') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(messages));
        }
        if (url.pathname !== '/v3/smtp/email' || req.method !== 'POST') {
            res.statusCode = 404;
            return res.end();
        }
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (mode === 'timeout') return; // never answers
            if (mode === 'fail') {
                res.statusCode = 401;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ message: 'mock: key not accepted' }));
            }
            if (mode === 'unreadable') {
                res.statusCode = 201;
                return res.end('not json');
            }
            let body = {};
            try { body = JSON.parse(raw); } catch { /* ignore */ }
            const messageId = '<mock-' + (++counter) + '@agross.local>';
            messages.push({ messageId, to: body.to, replyTo: body.replyTo, subject: body.subject, text: body.textContent });
            res.statusCode = 201;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ messageId }));
        });
    });

    return {
        server, messages,
        setMode(value) { mode = value; },
        listen: port => new Promise(resolve => server.listen(port, '127.0.0.1', resolve)),
        close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); })
    };
}

module.exports = { createMockBrevo };

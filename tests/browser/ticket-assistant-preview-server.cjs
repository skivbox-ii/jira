const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const amd = `(() => {
    const modules = new Map([['jquery', {value: window.jQuery}]]);
    window.define = (name, deps, factory) => {
        if (modules.has(name)) throw new Error('Duplicate AMD: ' + name);
        modules.set(name, {deps, factory});
    };
    window.define.amd = true;
    window.taRequire = name => {
        const entry = modules.get(name);
        if (!entry) throw new Error('Missing AMD: ' + name);
        if (!('value' in entry)) entry.value = entry.factory(...entry.deps.map(window.taRequire));
        return entry.value;
    };
})();`;
async function startPreview({port = 4320} = {}) {
    const files = new Map([
        ['/', [path.join(__dirname, 'ticket-assistant-preview.html'), 'text/html; charset=utf-8']],
        ['/jquery.js', [require.resolve('jquery/dist/jquery.js'), 'text/javascript; charset=utf-8']],
        ['/preview.js', [path.join(__dirname, 'ticket-assistant-preview.cjs'), 'text/javascript; charset=utf-8']],
        ['/ujg-ticket-assistant.runtime.js', [path.join(root, 'ujg-ticket-assistant.runtime.js'), 'text/javascript; charset=utf-8']],
        ['/ujg-ticket-assistant.css', [path.join(root, 'ujg-ticket-assistant.css'), 'text/css; charset=utf-8']]
    ]);
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405); res.end(); return;}
        const route = new URL(req.url, 'http://127.0.0.1').pathname;
        if (route === '/favicon.ico') {res.writeHead(204); res.end(); return;}
        if (route === '/amd.js') {res.setHeader('Content-Type', 'text/javascript'); res.end(req.method === 'HEAD' ? '' : amd); return;}
        const entry = files.get(route);
        if (!entry) {res.writeHead(404); res.end(); return;}
        try {const content = fs.readFileSync(entry[0]); res.setHeader('Content-Type', entry[1]); res.end(req.method === 'HEAD' ? '' : content);}
        catch (error) {res.writeHead(500); res.end('Build ticket assistant assets before preview.');}
    });
    async function listen(chosenPort) {
        return new Promise((resolve, reject) => {
            function fail(error) {server.off('listening', ready); reject(error);}
            function ready() {server.off('error', fail); resolve();}
            server.once('error', fail); server.once('listening', ready); server.listen(chosenPort, '127.0.0.1');
        });
    }
    try {await listen(port);} catch (error) {if (error.code !== 'EADDRINUSE' || port === 0) throw error; await listen(0);}
    return {url:'http://127.0.0.1:' + server.address().port + '/', close:() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))};
}
if (require.main === module) startPreview().then(preview => {console.log('Ticket assistant offline preview: ' + preview.url);}, error => {console.error(error); process.exitCode = 1;});
module.exports = {startPreview};

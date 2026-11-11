'use strict';

// Terminal prompts for the admin scripts. Passwords are typed without being shown.
const readline = require('node:readline');

let rl = null;
let muted = false;
const queued = [];
let waiting = null;

function open() {
    if (rl) return;
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = text => { if (!muted) write(text); };
    // Lines that arrive before the next question (for example pasted input) are kept, not lost.
    rl.on('line', line => { if (waiting) { const done = waiting; waiting = null; done(line); } else queued.push(line); });
    rl.on('close', () => { if (waiting) { const done = waiting; waiting = null; done(''); } });
}

function ask(question, { hidden = false } = {}) {
    open();
    process.stdout.write(question);
    muted = hidden;
    return new Promise(resolve => {
        const finish = line => { muted = false; if (hidden) process.stdout.write('\n'); resolve(line); };
        if (queued.length) finish(queued.shift());
        else waiting = finish;
    });
}

function done() {
    if (rl) rl.close();
}

module.exports = { ask, done };

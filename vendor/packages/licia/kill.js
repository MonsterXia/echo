const isWindows = require('./isWindows');

const childProcess = require('child_process');

exports = function(pid) {
    try {
        if (isWindows) {
            childProcess.spawnSync('taskkill', ['/pid', pid, '/T', '/F'], {
                stdio: 'ignore'
            });
        } else {
            process.kill(pid, 'SIGKILL');
        }
    } catch (e) {}
};

module.exports = exports;

var isStr = require('./isStr');
var strToBytes = require('./strToBytes');
var hex = require('./hex');
var bytesToWords = require('./bytesToWords');
var wordsToBytes = require('./wordsToBytes');
var isNode = require('./isNode');
var isArr = require('./isArr');

exports = function(msg) {
    if (isStr(msg)) msg = strToBytes(msg);
    var m = bytesToWords(msg);
    var l = msg.length * 8;
    var a = 1732584193;
    var b = -271733879;
    var c = -1732584194;
    var d = 271733878;
    var e = -1009589776;
    m[l >> 5] |= 0x80 << (24 - (l % 32));
    m[(((l + 64) >> 9) << 4) + 15] = l;
    var w = [];
    for (var i = 0; i < m.length; i += 16) {
        var aa = a;
        var bb = b;
        var cc = c;
        var dd = d;
        var ee = e;
        for (var j = 0; j < 80; j++) {
            if (j < 16) {
                w[j] = m[i + j] | 0;
            } else {
                var n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
                w[j] = (n << 1) | (n >>> 31);
            }
            var t =
                (((a << 5) | (a >>> 27)) +
                    e +
                    (w[j] >>> 0) +
                    (j < 20
                        ? ((b & c) | (~b & d)) + 1518500249
                        : j < 40
                        ? (b ^ c ^ d) + 1859775393
                        : j < 60
                        ? ((b & c) | (b & d) | (c & d)) - 1894007588
                        : (b ^ c ^ d) - 899497514)) |
                0;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
        }
        a = (a + aa) | 0;
        b = (b + bb) | 0;
        c = (c + cc) | 0;
        d = (d + dd) | 0;
        e = (e + ee) | 0;
    }
    return hex.encode(wordsToBytes([a, b, c, d, e]));
};
if (isNode) {
    var crypto = eval('require')('crypto');
    exports = function(msg) {
        if (isArr(msg)) {
            msg = Buffer.from(msg);
        }
        var hash = crypto.createHash('sha1');
        hash.update(msg);
        return hash.digest('hex');
    };
}

module.exports = exports;

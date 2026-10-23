import utf8 = require('./utf8');
import hex = require('./hex');
import base64 = require('./base64');

declare function bytesToStr(
    bytes: number[] | Uint8Array | ArrayBufferView,
    encoding?: 'utf8' | 'hex' | 'base64' | string
): string;

export = bytesToStr;

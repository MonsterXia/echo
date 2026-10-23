import utf8 = require('./utf8');
import hex = require('./hex');
import base64 = require('./base64');

declare function strToBytes(
    str: string,
    encoding?: 'utf8' | 'hex' | 'base64' | string
): number[];

export = strToBytes;

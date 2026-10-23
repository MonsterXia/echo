import base64 = require('./base64');
import type = require('./type');

declare namespace convertBin {
    type Source =
        | string
        | number[]
        | ArrayBuffer
        | ArrayBufferView
        | Uint8Array;
    function blobToArrBuffer(blob: Blob): Promise<ArrayBuffer>;
}
declare function convertBin(
    bin: convertBin.Source,
    type: 'Uint8Array' | 'uint8array'
): Uint8Array;
declare function convertBin(
    bin: convertBin.Source,
    type: 'Array' | 'array'
): number[];
declare function convertBin(
    bin: convertBin.Source,
    type: 'ArrayBuffer' | 'arraybuffer'
): ArrayBuffer;
declare function convertBin(bin: convertBin.Source, type: 'base64'): string;
declare function convertBin(
    bin: convertBin.Source,
    type: 'Blob' | 'blob'
): Blob;
declare function convertBin(
    bin: convertBin.Source,
    type: 'Buffer' | 'buffer'
): any;
declare function convertBin(bin: any, type: string): any;

export = convertBin;

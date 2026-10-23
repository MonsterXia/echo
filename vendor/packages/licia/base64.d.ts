declare const base64: {
    encode(bytes: number[] | Uint8Array | ArrayBufferView): string;
    decode(str: string): number[];
};

export = base64;

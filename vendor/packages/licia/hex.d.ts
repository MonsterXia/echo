declare const hex: {
    encode(bytes: number[] | Uint8Array | ArrayBufferView): string;
    decode(str: string): number[];
};

export = hex;

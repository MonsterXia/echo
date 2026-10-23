declare function toArr(val: null | undefined): any[];
declare function toArr(val: string): string[];
declare function toArr<T>(val: T[]): T[];
declare function toArr<T>(val: ArrayLike<T>): T[];
declare function toArr<T>(val: T): T[];

export = toArr;

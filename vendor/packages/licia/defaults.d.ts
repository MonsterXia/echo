declare function defaults<T, T1>(obj: T, source1: T1): T & T1;
declare function defaults<T, T1, T2>(
    obj: T,
    source1: T1,
    source2: T2
): T & T1 & T2;
declare function defaults<T, T1, T2, T3>(
    obj: T,
    source1: T1,
    source2: T2,
    source3: T3
): T & T1 & T2 & T3;
declare function defaults(obj: any, ...src: any[]): any;

export = defaults;

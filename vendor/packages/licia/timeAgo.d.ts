declare namespace timeAgo {
    interface ITimeAgo {
        (date: Date | number, now?: Date | number): string;
        i18n: string[][];
    }
}
declare const timeAgo: timeAgo.ITimeAgo;

export = timeAgo;

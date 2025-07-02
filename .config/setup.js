module.exports = function (
    /** @type {{ registerHelper: (arg0: string, arg1: { (context: any): any; (context: any): any; }) => void; }} */
    Handlebars,
) {
    Handlebars.registerHelper('replaceCommit', function (context) {
        const commit =
            /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|deprecate|style|test)\s?(\((.*?)\))?!?: (.*?)$/g;

        // @ts-ignore
        const string = context.fn(this);
        const parsed = Array.from(string.matchAll(commit) ?? [])[0] ?? [];
        const [, type = '', , scope = '', title = ''] = parsed;
        let result = "";
        if (scope)
        {
            result = `${type}(${scope.toLowerCase()}): ${title}`
        }
        else
        {
            result = `${type}: ${title}`;
        }
        let emoji = "";
        switch (type) {
            case 'chore':
                emoji = "🔨";
                break;
            case 'feat':
                emoji = "✨";
                break;
            case 'fix':
                emoji = "🐞";
                break;
            case 'perf':
                emoji = "⚡️";
                break;
            case 'refactor':
                emoji = "🔧";
                break;
            case 'style':
                emoji = "🎨";
                break;
            case 'deprecate':
                emoji = "⚠️";
                break;
        }
       

        return `${emoji} ${result}` || 'empty commit name';
    });

    Handlebars.registerHelper('replaceTitle', function (context) {
        // @ts-ignore
        const string = context.fn(this);

        return string.replace('v', '');
    });

    // @ts-ignore
    Handlebars.registerHelper('commit-parser', (merges, commits, options) => {
        // @ts-ignore
        const commitsFromMerges = merges.map((merge) => merge.commit);
        const result = commits.concat(commitsFromMerges);

        return options.fn(result);
    });

    // Helper for array lookup
    Handlebars.registerHelper('lookup', function (obj, index) {
        return obj[index];
    });
};

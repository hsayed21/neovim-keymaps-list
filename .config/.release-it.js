/* eslint-disable no-template-curly-in-string */
const changelog = `npx auto-changelog --commit-limit false --unreleased --template .config\\template.hbs --handlebars-setup .config\\setup.js`;

module.exports = {
    plugins: {
        '@release-it/conventional-changelog': {
            gitRawCommitsOpts: {
                path: '.',
            },
            path: '.',
            preset: 'conventionalcommits',
            infile: false,
        },
    },
    git: {
        commitMessage: "chore(release): v${version}",
        requireCleanWorkingDir: false,
        getLatestTagFromAllRefs: true,
        pushArgs: ['--follow-tags'],
        changelog: "npx auto-changelog --stdout --commit-limit false --unreleased --template https://raw.githubusercontent.com/release-it/release-it/main/templates/changelog-compact.hbs"
    },
    hooks: {
        'after:npm:bump': `npx auto-changelog --commit-limit false -p > NUL 2>&1`,
        // "after:release": `release-it --ci --no-increment --no-npm --no-git --github.release --github.update  --stdout' --no-github.draft --no-git.tag --no-git.commit --no-git.push`,
    },
    github: {
        release: true,
        releaseName: "v${version}",
        releaseNotes: `${changelog} --stdout --unreleased-only`,
    },
    npm: {
        publish: false,
    },
    verbose: true,
};

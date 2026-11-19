export default [{
    files: ['**/*.js'],
    ignores: ['dist/**'],
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: {
            global: 'readonly',
        },
    },
    rules: {
        'no-constant-condition': 'error',
        'no-undef': 'error',
        'no-unreachable': 'error',
        'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
    },
}];

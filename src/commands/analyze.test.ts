import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAnalyzeCommands } from './analyze.js';

describe('registerAnalyzeCommands', () => {
    it('registers the analyze command and its aliases/options', () => {
        const program = new Command();
        registerAnalyzeCommands(program);

        const analyzeCmd = program.commands.find((c) => c.name() === 'analyze');
        expect(analyzeCmd).toBeDefined();
        expect(analyzeCmd?.aliases()).toContain('check');

        const optionFlags = analyzeCmd?.options.map((o) => o.long);
        expect(optionFlags).toContain('--data-dir');
        expect(optionFlags).toContain('--config');
        expect(optionFlags).toContain('--output');
        expect(optionFlags).toContain('--session');
        expect(optionFlags).toContain('--no-save');
        expect(optionFlags).toContain('--json');
    });
});

#!/usr/bin/env node
/**
 * 4C-Checker CLI Entry Point
 * Điều phối các subcommands và xử lý cấu hình toàn cục
 */
import { Command } from 'commander';
import pc from 'picocolors';
import { setGlobalLogLevel } from './utils/logger.js';
import { registerAllCommands } from './commands/index.js';

const program = new Command();

program
    .name('4c-checker')
    .description('Công cụ kiểm tra bài tập CAD và phát hiện gian lận tự động cho 4CHaUI')
    .version('0.1.0')
    .option('-v, --verbose', 'Hiển thị log chi tiết')
    .hook('preAction', (thisCommand) => {
        if (thisCommand.opts().verbose) {
            setGlobalLogLevel('debug');
        }
    });

// Đăng ký toàn bộ commands từ module
registerAllCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(pc.red(`\n❌ Lỗi thực thi: ${(err as Error).message}\n`));
    process.exit(1);
});

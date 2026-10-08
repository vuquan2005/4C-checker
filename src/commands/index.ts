import { Command } from 'commander';
import { registerCadCommands } from './cad.js';
import { registerNetworkCommands } from './network.js';
import { registerParserCommands } from './parser.js';

/**
 * Đăng ký tất cả các subcommands vào Root Commander
 */
export function registerAllCommands(program: Command): void {
    registerCadCommands(program);
    registerNetworkCommands(program);
    registerParserCommands(program);
}

export { registerCadCommands } from './cad.js';
export { registerNetworkCommands, parseThreadIdInput } from './network.js';
export { registerParserCommands } from './parser.js';

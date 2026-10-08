import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { parseCadMetadata, extractPreviewFromFile, savePreviewToFile } from '../index.js';

/**
 * Đăng ký các câu lệnh làm việc với file CAD Autodesk Inventor (inspect, extract)
 */
export function registerCadCommands(program: Command): void {
    program
        .command('inspect')
        .description('Đọc và hiển thị toàn bộ dữ liệu trong file CAD')
        .argument('<cad-file>', 'Đường dẫn tới file CAD (.ipt, .iam, .ipn)')
        .option('--json', 'Xuất toàn bộ kết quả dưới dạng JSON')
        .action((cadFile: string, options: { json?: boolean }) => {
            try {
                const meta = parseCadMetadata(cadFile);

                if (options.json) {
                    console.log(JSON.stringify(meta, null, 2));
                    return;
                }

                console.log(
                    pc.bold(
                        pc.cyan(
                            `\n════════════════════════════════════════════════════════════════`
                        )
                    )
                );
                console.log(pc.bold(pc.cyan(`  PHÂN TÍCH FILE CAD: ${meta.fileName}`)));
                console.log(
                    pc.bold(
                        pc.cyan(`════════════════════════════════════════════════════════════════`)
                    )
                );
                console.log(`- Phiên bản Inventor:    ${meta.softwareVersion || 'N/A'}`);
                console.log(`- Tác giả (Designer):    ${meta.designer || meta.author || 'N/A'}`);
                console.log(`- User Windows gần nhất: ${meta.lastSavedByWindowsUser || 'N/A'}`);
                console.log(`- Đường dẫn máy gốc:     ${meta.originalFilePath || 'N/A'}`);
                console.log(`- Ngày tạo gốc ban đầu:  ${meta.creationDate || 'N/A'}`);
                console.log(`- Ngày lưu sau cùng:     ${meta.lastSavedDate || 'N/A'}`);
                console.log(`- Tên Part:              ${meta.partNumber || 'N/A'}`);
                console.log(
                    `- Vân tay gốc tài liệu:  ${meta.rseSegmentIds.length} segments [${meta.rseSegmentIds[0] || ''}...]`
                );
                console.log(
                    `- Vân tay hình học 3D:   ${meta.geometryFingerprint ? `${meta.geometryFingerprint.totalStreams} streams, Hash: ${meta.geometryFingerprint.contentHash}` : 'N/A'}`
                );
                console.log(
                    `- 3D Preview:            ${meta.hasPreview ? `${meta.previewWidth}x${meta.previewHeight} PNG` : 'Không có'}\n`
                );
            } catch (err) {
                console.error(pc.red(`\n❌ Lỗi: ${(err as Error).message}\n`));
                process.exit(1);
            }
        });

    program
        .command('extract')
        .description('Trích xuất ảnh 3D preview từ file CAD thành file PNG')
        .argument('<cad-file>', 'Đường dẫn file CAD')
        .argument('[output-png]', 'Đường dẫn file PNG đầu ra')
        .action((cadFile: string, outputPng?: string) => {
            try {
                const preview = extractPreviewFromFile(cadFile);
                if (!preview) {
                    console.log(pc.yellow('\n⚠️ Không tìm thấy ảnh preview.\n'));
                    return;
                }

                const defaultOut = path.join(
                    path.dirname(cadFile),
                    `${path.basename(cadFile, path.extname(cadFile))}_preview.png`
                );
                const targetOut = outputPng || defaultOut;
                savePreviewToFile(cadFile, targetOut);
                console.log(pc.green(`\n✓ Đã trích xuất ảnh preview ra: ${targetOut}\n`));
            } catch (err) {
                console.error(pc.red(`\n❌ Lỗi: ${(err as Error).message}\n`));
                process.exit(1);
            }
        });
}

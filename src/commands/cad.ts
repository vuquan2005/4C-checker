import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import {
    parseCadMetadata,
    extractPreviewFromFile,
    savePreviewToFile,
    findFilesByExtension,
    ensureDir,
} from '../index.js';
import type { CadFileSummary, PostData } from '../preparation/types/manifest.js';

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
        .alias('re-extract')
        .alias('extract-cad')
        .description(
            'Trích xuất ảnh 3D preview từ file CAD thành file PNG (hỗ trợ file đơn, thư mục hoặc toàn bộ data)'
        )
        .argument(
            '[target]',
            'Đường dẫn file CAD, thư mục hoặc Thread ID (mặc định: ./data)',
            './data'
        )
        .argument('[output]', 'Đường dẫn file PNG đầu ra (cho file đơn) hoặc thư mục đầu ra')
        .action((targetPath: string = './data', outputPath?: string) => {
            try {
                let resolvedTarget = path.resolve(targetPath);
                if (!fs.existsSync(resolvedTarget)) {
                    // Thử kiểm tra xem có phải là thread ID trong ./data không (ví dụ: "1336")
                    const candidateInDefaultData = path.resolve('./data', targetPath);
                    if (fs.existsSync(candidateInDefaultData)) {
                        resolvedTarget = candidateInDefaultData;
                    } else {
                        console.error(pc.red(`\n❌ Không tìm thấy đường dẫn: ${resolvedTarget}\n`));
                        process.exit(1);
                    }
                }

                const stat = fs.statSync(resolvedTarget);
                if (stat.isDirectory()) {
                    const cadFiles = findFilesByExtension(resolvedTarget, ['.ipt', '.iam', '.ipn']);
                    if (cadFiles.length === 0) {
                        console.log(
                            pc.yellow(`\n⚠️ Không tìm thấy file CAD nào trong: ${resolvedTarget}\n`)
                        );
                        return;
                    }

                    console.log(
                        pc.cyan(
                            `\n🔍 Tìm thấy ${cadFiles.length} file CAD. Đang trích xuất preview...`
                        )
                    );

                    let extractedCount = 0;
                    const updatedPostJsons = new Set<string>();

                    for (const cadFile of cadFiles) {
                        const parsed = path.parse(cadFile);
                        let targetOut: string;

                        if (outputPath) {
                            ensureDir(outputPath);
                            targetOut = path.join(outputPath, `${parsed.name}.png`);
                        } else {
                            // Check if inside a post folder (.../drive_files/...)
                            const dirName = path.dirname(cadFile);
                            const driveIdx = dirName.lastIndexOf('drive_files');
                            if (driveIdx !== -1) {
                                const postDir = dirName.substring(0, driveIdx - 1);
                                const previewsDir = path.join(postDir, 'cad_previews');
                                ensureDir(previewsDir);
                                targetOut = path.join(previewsDir, `${parsed.name}.png`);
                            } else {
                                targetOut = path.join(dirName, `${parsed.name}_preview.png`);
                            }
                        }

                        const saved = savePreviewToFile(cadFile, targetOut);
                        if (saved) {
                            extractedCount++;
                        }

                        // Check if post.json needs updating
                        const postJsonCandidates = [
                            path.join(path.dirname(cadFile), 'post.json'),
                            path.join(path.dirname(path.dirname(cadFile)), 'post.json'),
                        ];
                        for (const pj of postJsonCandidates) {
                            if (fs.existsSync(pj) && !updatedPostJsons.has(pj)) {
                                updatedPostJsons.add(pj);
                            }
                        }
                    }

                    // Update cadSummaries in any post.json found
                    for (const pj of updatedPostJsons) {
                        try {
                            const postDir = path.dirname(pj);
                            const driveDir = path.join(postDir, 'drive_files');
                            const cadPreviewsDir = path.join(postDir, 'cad_previews');
                            if (fs.existsSync(driveDir)) {
                                const postCadFiles = findFilesByExtension(driveDir, [
                                    '.ipt',
                                    '.iam',
                                    '.ipn',
                                ]);
                                const post = JSON.parse(fs.readFileSync(pj, 'utf8')) as PostData;
                                const newSummaries: CadFileSummary[] = [];

                                for (const pcf of postCadFiles) {
                                    try {
                                        const metadata = parseCadMetadata(pcf);
                                        const pName = path.parse(pcf).name;
                                        const previewFile = path.join(
                                            cadPreviewsDir,
                                            `${pName}.png`
                                        );
                                        newSummaries.push({
                                            ...metadata,
                                            localPath: path.relative(postDir, pcf),
                                            previewPath: fs.existsSync(previewFile)
                                                ? path.relative(postDir, previewFile)
                                                : undefined,
                                        });
                                    } catch {
                                        // Ignore
                                    }
                                }

                                post.cadSummaries = newSummaries;
                                fs.writeFileSync(pj, JSON.stringify(post, null, 2), 'utf8');
                            }
                        } catch {
                            // Non-fatal
                        }
                    }

                    console.log(
                        pc.green(
                            `\n✓ Đã trích xuất thành công ${extractedCount}/${cadFiles.length} ảnh preview.`
                        )
                    );
                    if (updatedPostJsons.size > 0) {
                        console.log(
                            pc.green(
                                `✓ Đã cập nhật metadata trong ${updatedPostJsons.size} file post.json.\n`
                            )
                        );
                    }
                    return;
                }

                // Single file mode
                const preview = extractPreviewFromFile(resolvedTarget);
                if (!preview) {
                    console.log(pc.yellow('\n⚠️ Không tìm thấy ảnh preview.\n'));
                    return;
                }

                const defaultOut = path.join(
                    path.dirname(resolvedTarget),
                    `${path.basename(resolvedTarget, path.extname(resolvedTarget))}_preview.png`
                );
                const targetOut = outputPath || defaultOut;
                savePreviewToFile(resolvedTarget, targetOut);
                console.log(pc.green(`\n✓ Đã trích xuất ảnh preview ra: ${targetOut}\n`));
            } catch (err) {
                console.error(pc.red(`\n❌ Lỗi: ${(err as Error).message}\n`));
                process.exit(1);
            }
        });
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { needsPostAssetReprocessing, syncThread } from './orchestrator.js';

describe('Thread Pipeline Orchestrator', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-orch-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    const mockThreadHtml = `
    <html>
      <body>
        <!-- Post 1 (OP - should be ignored by default) -->
        <div class="post" id="post_100">
          <div class="post_head">
            <div class="float_right"><strong><a href="#">#1</a></strong></div>
            <span class="post_date">10-01-2026, 08:00 AM</span>
          </div>
          <div class="post_author">
            <div class="author_information"><span class="largetext"><a href="member.php?action=profile&uid=1">Admin</a></span></div>
          </div>
          <div class="post_body" id="pid_100">Thread announcement</div>
        </div>

        <!-- Post 2 (Student Alpha) -->
        <div class="post" id="post_101">
          <div class="post_head">
            <div class="float_right"><strong><a href="#">#2</a></strong></div>
            <span class="post_date">10-01-2026, 09:00 AM</span>
          </div>
          <div class="post_author">
            <div class="author_information"><span class="largetext"><a href="member.php?action=profile&uid=201">Student Alpha_K16</a></span></div>
          </div>
          <div class="post_body" id="pid_101">
            Student Alpha submission
            <a href="https://drive.google.com/file/d/alpha_file/view">Google Drive</a>
            <img src="https://example.com/alpha.png" />
          </div>
        </div>

        <!-- Post 3 (Student Beta) -->
        <div class="post" id="post_102">
          <div class="post_head">
            <div class="float_right"><strong><a href="#">#3</a></strong></div>
            <span class="post_date">10-01-2026, 10:00 AM</span>
          </div>
          <div class="post_author">
            <div class="author_information"><span class="largetext"><a href="member.php?action=profile&uid=202">Student Beta_K16</a></span></div>
          </div>
          <div class="post_body" id="pid_102">
            Student Beta submission
            <a href="https://drive.google.com/file/d/beta_file/view">Google Drive</a>
          </div>
        </div>
      </body>
    </html>
    `;

    it('synchronizes thread in metadata-only mode without downloading assets', async () => {
        const events: string[] = [];

        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            metadataOnly: true,
            onProgress: (ev) => events.push(ev.type),
        });

        expect(summary.threadId).toBe('999');
        expect(summary.totalDiscoveredPosts).toBe(2); // OP ignored
        expect(summary.newPostsCount).toBe(2);
        expect(summary.processedPostsCount).toBe(0); // metadataOnly skipped asset download

        // Check manifest file
        const manifestPath = path.join(tempDir, '999', 'thread.json');
        expect(fs.existsSync(manifestPath)).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.stats.totalPosts).toBe(2);
        expect(manifest.posts['101'].userFolder).toBe('Student_Alpha_201');
        expect(manifest.posts['102'].userFolder).toBe('Student_Beta_202');

        expect(events).toContain('posts_parsed');
        expect(events).toContain('manifest_updated');
        expect(events).toContain('completed');
    });

    it('processes post assets end-to-end and saves summaries', async () => {
        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            metadataOnly: false,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
        });

        expect(summary.totalDiscoveredPosts).toBe(2);
        expect(summary.processedPostsCount).toBe(2);

        // Verify post summaries are created on disk
        const alphaSummaryPath = path.join(
            tempDir,
            '999',
            'Student_Alpha_201',
            'post_101',
            'post.json'
        );
        expect(fs.existsSync(alphaSummaryPath)).toBe(true);

        const alphaSummary = JSON.parse(fs.readFileSync(alphaSummaryPath, 'utf8'));
        expect(alphaSummary.postId).toBe('101');
        expect(alphaSummary.currentVersion).toBe(1);
        expect(alphaSummary.sessionOverride).toBeNull();
        expect(needsPostAssetReprocessing(tempDir, '999', summary.manifest.posts['101'])).toBe(
            false
        );

        alphaSummary.sessionOverride = 4;
        fs.writeFileSync(alphaSummaryPath, JSON.stringify(alphaSummary));
        expect(needsPostAssetReprocessing(tempDir, '999', summary.manifest.posts['101'])).toBe(
            true
        );

        summary.manifest.posts['101'].sessionOverride = 4;
        expect(needsPostAssetReprocessing(tempDir, '999', summary.manifest.posts['101'])).toBe(
            false
        );
        expect(summary.manifest.posts['101'].sessionOverride).toBe(4);
    });

    it('resolves session conflicts before processing the post', async () => {
        const conflictHtml = mockThreadHtml
            .replace('Student Alpha submission', 'Student Alpha submission b2')
            .replace('Student Beta_K16', 'Student Alpha_K16')
            .replace('uid=202', 'uid=201')
            .replace('Student Beta submission', 'Student Alpha submission b4');
        const conflicts: Array<[string, number, number]> = [];

        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: conflictHtml,
            metadataOnly: false,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
            onSessionConflict: (record, declaredSession, inferredSession) => {
                conflicts.push([record.postId, declaredSession, inferredSession]);
                return 3;
            },
        });

        expect(conflicts).toEqual([['102', 4, 3]]);
        expect(summary.manifest.posts['102'].sessionOverride).toBe(3);

        const postSummaryPath = path.join(
            tempDir,
            '999',
            'Student_Alpha_201',
            'post_102',
            'post.json'
        );
        expect(JSON.parse(fs.readFileSync(postSummaryPath, 'utf8')).sessionOverride).toBe(3);

        const configPath = path.join(tempDir, '999', 'config.json');
        expect(
            JSON.parse(fs.readFileSync(configPath, 'utf8')).prepare.session.overrides['102']
        ).toBe(3);
    });

    it('automatically applies session.overrides from config without triggering conflict handler', async () => {
        const conflictHtml = mockThreadHtml
            .replace('Student Alpha submission', 'Student Alpha submission b2')
            .replace('Student Beta_K16', 'Student Alpha_K16')
            .replace('uid=202', 'uid=201')
            .replace('Student Beta submission', 'Student Alpha submission b4');
        let conflictPrompted = false;

        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: conflictHtml,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
            config: {
                prepare: {
                    session: {
                        overrides: {
                            '102': 5,
                        },
                    },
                },
            },
            onSessionConflict: () => {
                conflictPrompted = true;
                return undefined;
            },
        });

        expect(conflictPrompted).toBe(false);
        expect(summary.manifest.posts['102'].sessionOverride).toBe(5);
        expect(summary.manifest.posts['102'].sessionIndex).toBe(5);
        expect(summary.manifest.posts['102'].sessionSource).toBe('override');
    });

    it('detects a previously failed Drive summary for reprocessing', async () => {
        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            metadataOnly: false,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
        });
        const record = summary.manifest.posts['101'];
        const summaryPath = path.join(
            tempDir,
            '999',
            record.userFolder,
            record.postFolder,
            'post.json'
        );
        const postSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        postSummary.driveFiles = {
            ...postSummary.driveFiles,
            status: 'failed',
        };
        fs.writeFileSync(summaryPath, JSON.stringify(postSummary));

        expect(needsPostAssetReprocessing(tempDir, '999', record)).toBe(true);
    });

    it('skips ignored posts even when force processing is requested', async () => {
        const firstRun = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            metadataOnly: false,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
        });
        expect(firstRun.processedPostsCount).toBe(2);

        // Ignore post 101 via config.json
        const configPath = path.join(tempDir, '999', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config.prepare.ignore.postIds = ['101'];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const secondRun = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            force: true,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
        });

        expect(secondRun.processedPostsCount).toBe(1);
        expect(secondRun.manifest.posts['101'].skipProcessing).toBe(true);
        expect(secondRun.manifest.posts['101'].skipReason).toContain('IGNORED_POST_ID: 101');
    });

    it('skips posts configured in ThreadConfig ignore rules and creates config.json template', async () => {
        const summary = await syncThread('999', {
            dataDir: tempDir,
            htmlContent: mockThreadHtml,
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
            config: {
                prepare: {
                    ignore: {
                        uids: ['201'], // Student Alpha
                    },
                },
            },
        });

        // Student Alpha (UID 201) was ignored via config, only Student Beta (UID 202) was processed
        expect(summary.processedPostsCount).toBe(1);
        expect(summary.manifest.posts['101'].skipProcessing).toBe(true);
        expect(summary.manifest.posts['101'].skipReason).toContain('IGNORED_UID: 201');
        expect(summary.manifest.posts['102'].skipProcessing).toBeUndefined();

        // Check that config.json was created
        const configPath = path.join(tempDir, '999', 'config.json');
        expect(fs.existsSync(configPath)).toBe(true);
    });
});

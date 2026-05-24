import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { createReadStream } from 'fs';
import { Blob } from 'buffer';

const { put } = await import('@vercel/blob');

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!BLOB_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN not set');
    process.exit(1);
}

async function uploadDirectory(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await uploadDirectory(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }

    return files;
}

async function main() {
    console.log('Uploading static assets to Vercel Blob...');
    const files = await uploadDirectory(PUBLIC_DIR);
    console.log(`Found ${files.length} files`);

    let uploaded = 0;
    for (const file of files) {
        const blobPath = relative(PUBLIC_DIR, file);
        const content = readFileSync(file);
        const contentType = getContentType(file);

        try {
            const result = await put(blobPath, content, {
                access: 'public',
                contentType,
                addRandomSuffix: false,
            });
            console.log(`  ✓ ${blobPath} → ${result.url}`);
            uploaded++;
        } catch (err) {
            console.error(`  ✗ ${blobPath}: ${err.message}`);
        }
    }

    console.log(`\nUploaded ${uploaded}/${files.length} files`);
    console.log(`\nSet ASSETS_URL to your Blob URL prefix in Vercel env vars:`);
    console.log(`ASSETS_URL=https://<your-blob-store>.public.blob.vercel-storage.com`);
}

function getContentType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const types = {
        css: 'text/css',
        js: 'application/javascript',
        html: 'text/html',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        ico: 'image/x-icon',
        xml: 'application/xml',
        txt: 'text/plain',
        json: 'application/json',
    };
    return types[ext] || 'application/octet-stream';
}

main().catch((err) => {
    console.error('Upload failed:', err);
    process.exit(1);
});

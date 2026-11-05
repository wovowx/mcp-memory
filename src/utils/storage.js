// ============================================================
// Supabase 存储操作（通用版 + 自动创建bucket）
// ============================================================
function getFileExtension(file) {
    if (file.name && file.name.includes('.')) return file.name.split('.').pop();
    const mimeMap = {
        'image/': 'jpg', 'video/': 'mp4', 'audio/': 'mp3',
        'application/pdf': 'pdf', 'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'text/': 'txt', 'application/zip': 'zip',
        'application/x-rar-compressed': 'rar', 'application/x-7z-compressed': '7z'
    };
    for (const [prefix, ext] of Object.entries(mimeMap)) if (file.type.startsWith(prefix)) return ext;
    return 'bin';
}
function getContentType(file) {
    const type = file.type;
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type === 'application/pdf' || type.includes('document') || type.includes('word') || type.includes('excel') || type.includes('powerpoint')) return 'document';
    if (type === 'application/zip' || type === 'application/x-rar-compressed' || type === 'application/x-7z-compressed') return 'archive';
    if (type.startsWith('text/')) return 'text';
    return 'other';
}
// 确保bucket存在，不存在则创建
async function ensureBucket(supabaseUrl, supabaseKey, bucketName) {
    // 尝试获取bucket信息
    const checkResp = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucketName}`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (checkResp.ok) return true;
    // bucket不存在，创建它
    const createResp = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucketName, name: bucketName, public: true })
    });
    if (!createResp.ok) {
        const errText = await createResp.text();
        throw new Error(`创建bucket失败: ${createResp.status} ${errText}`);
    }
    return true;
}
export async function uploadFileToSupabase(file, env, metadata = {}) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase 未配置');
    const BUCKET = 'files';
    await ensureBucket(supabaseUrl, supabaseKey, BUCKET);
    const id = crypto.randomUUID();
    const fileExt = getFileExtension(file);
    const fileName = `${id}.${fileExt}`;
    const fileBuffer = await file.arrayBuffer();
    const uploadResp = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${fileName}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
            'Content-Type': file.type || 'application/octet-stream'
        },
        body: fileBuffer
    });
    if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        throw new Error(`上传失败: ${uploadResp.status} ${errText}`);
    }
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${fileName}`;
    const contentType = getContentType(file);
    const category = metadata.category || '未分类';
    const tags = metadata.tags || [];
    const description = metadata.description || '';
    const dbResp = await fetch(`${supabaseUrl}/rest/v1/files`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
            'Content-Type': 'application/json', 'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            file_path: fileName, file_name: file.name, file_size: file.size,
            file_type: file.type, content_type: contentType, category: category,
            tags: tags, description: description, storage_url: storageUrl
        })
    });
    if (!dbResp.ok) {
        const errText = await dbResp.text();
        throw new Error(`数据库写入失败: ${dbResp.status} ${errText}`);
    }
    const dbData = await dbResp.json();
    return {
        id: dbData[0]?.id || id, url: storageUrl, name: file.name, size: file.size,
        type: file.type, content_type: contentType, category: category, tags: tags,
        description: description, created_at: dbData[0]?.created_at || new Date().toISOString()
    };
}
export async function queryFiles(env, filters = {}) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase 未配置');
    let query = `${supabaseUrl}/rest/v1/files?select=*`;
    if (filters.category) query += `&category=eq.${encodeURIComponent(filters.category)}`;
    if (filters.content_type) query += `&content_type=eq.${filters.content_type}`;
    if (filters.tags && filters.tags.length > 0) {
        const tagConditions = filters.tags.map(t => `tags.cs.{${t}}`).join(',');
        query += `&or=(${tagConditions})`;
    }
    if (filters.keyword) query += `&or=(file_name.ilike.*${encodeURIComponent(filters.keyword)}*,description.ilike.*${encodeURIComponent(filters.keyword)}*)`;
    if (filters.limit) query += `&limit=${filters.limit}`;
    if (filters.offset) query += `&offset=${filters.offset}`;
    query += `&order=created_at.desc`;
    const resp = await fetch(query, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) { const errText = await resp.text(); throw new Error(`查询失败: ${resp.status} ${errText}`); }
    return await resp.json();
}

/**
 * Update searchable file metadata without touching the stored object.
 * Returns a structured result so tool facades can preserve their own wording.
 */
export async function updateFileMetadata(env, fileId, patch) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return { ok: false, code: 'not_configured' };

    const response = await fetch(
        `${supabaseUrl}/rest/v1/files?id=eq.${encodeURIComponent(fileId)}&select=id,file_name,category,tags,description`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'apikey': supabaseKey,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(patch)
        }
    );
    if (!response.ok) {
        return {
            ok: false,
            code: 'http_error',
            status: response.status,
            detail: await response.text()
        };
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, code: 'not_found' };
    return { ok: true, row: rows[0] };
}

/**
 * Delete a file object first and its metadata row second.
 * A partial result is explicit: metadata is never removed unless Storage
 * confirms deletion, and empty/invalid representations are not success.
 */
export async function deleteFileFromSupabase(env, fileId) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return { ok: false, code: 'not_configured' };

    const headers = {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey
    };
    const lookup = await fetch(
        `${supabaseUrl}/rest/v1/files?select=id,file_path,file_name&id=eq.${encodeURIComponent(fileId)}`,
        { headers }
    );
    if (!lookup.ok) {
        return {
            ok: false,
            code: 'lookup_http',
            status: lookup.status,
            detail: await lookup.text()
        };
    }

    const rows = await lookup.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, code: 'not_found' };
    const file = rows[0];
    if (typeof file.file_path !== 'string' || !file.file_path.trim()) {
        return { ok: false, code: 'missing_path', file };
    }

    const objectPath = file.file_path.split('/').map(encodeURIComponent).join('/');
    const storageResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/files/${objectPath}`,
        { method: 'DELETE', headers }
    );
    if (!storageResponse.ok) {
        return {
            ok: false,
            code: 'storage_http',
            status: storageResponse.status,
            detail: await storageResponse.text(),
            file
        };
    }

    const metadataResponse = await fetch(
        `${supabaseUrl}/rest/v1/files?id=eq.${encodeURIComponent(fileId)}`,
        {
            method: 'DELETE',
            headers: { ...headers, 'Prefer': 'return=representation' }
        }
    );
    if (!metadataResponse.ok) {
        return {
            ok: false,
            code: 'metadata_http',
            status: metadataResponse.status,
            detail: await metadataResponse.text(),
            file,
            partial: true
        };
    }

    let deletedRows;
    try {
        deletedRows = await metadataResponse.json();
    } catch (error) {
        return {
            ok: false,
            code: 'metadata_unconfirmed',
            error: error?.message || String(error),
            file,
            partial: true
        };
    }
    if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
        return { ok: false, code: 'metadata_unconfirmed', file, partial: true };
    }
    return { ok: true, file };
}

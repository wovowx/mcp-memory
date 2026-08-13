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
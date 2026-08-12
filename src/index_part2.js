
async function handleUpload(request, env, ctx) {
  const formData = await request.formData();
  const file = formData.get('file');
  
  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const fileBuffer = await file.arrayBuffer();
  const mimeType = file.type || 'application/octet-stream';
  const ext = file.name.split('.').pop() || 'bin';
  const filename = `${Date.now()}.${ext}`;
  
  try {
    const resp = await fetch('https://shxfosnnaoxzscrhvkat.supabase.co/storage/v1/object/public/images/' + filename, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
        'apikey': env.SUPABASE_ANON_KEY,
        'Content-Type': mimeType
      },
      body: fileBuffer
    });
    
    if (resp.ok) {
      const url = `https://shxfosnnaoxzscrhvkat.supabase.co/storage/v1/object/public/images/${filename}`;
      return new Response(JSON.stringify({ 
        id: filename, 
        url, 
        name: file.name,
        size: file.size,
        type: mimeType 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ error: 'Upload failed', status: resp.status }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

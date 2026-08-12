// ============================================================
// AI 能力工具
// ============================================================
import { calculateStats } from '../utils/helpers.js';
import { getEnabledSkills } from '../utils/skills.js';
export async function handleAITool(name, safeArgs, env) {
    let text = '';
    // ============================================================
    // ds_quota - DeepSeek 余额查询
    // ============================================================
    if (name === 'ds_quota') {
        const apiKey = env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            text = '❌ DeepSeek API Key 未配置，请在环境变量中设置 DEEPSEEK_API_KEY';
        } else {
            try {
                const balanceResp = await fetch('https://api.deepseek.com/user/balance', {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    }
                });
                if (balanceResp.ok) {
                    const balanceData = await balanceResp.json();
                    if (balanceData.balance_infos && balanceData.balance_infos.length > 0) {
                        const info = balanceData.balance_infos[0];
                        text = '������ **DeepSeek 账户余额**\n\n' +
                            '������ 总余额：' + info.total_balance + ' ' + info.currency + '\n' +
                            '������ 赠送余额：' + info.granted_balance + ' ' + info.currency + '\n' +
                            '������ 充值余额：' + info.topped_up_balance + ' ' + info.currency;
                    } else {
                        text = '������ 余额信息：' + JSON.stringify(balanceData);
                    }
                } else {
                    text = '⚠️ 余额查询失败：HTTP ' + balanceResp.status;
                }
            } catch (e) {
                text = '❌ 查询失败：' + e.message;
            }
        }
    }
    // ============================================================
    // describe_image - 图片识别
    // ============================================================
    else if (name === 'describe_image') {
        if (!safeArgs.image_url) {
            text = '❌ 缺少参数：需要 image_url（通过 /upload 接口上传后获取）';
        } else {
            const apiKey = env.AGNES_API_KEY;
            if (!apiKey) {
                text = '❌ 请设置环境变量 AGNES_API_KEY';
            } else {
                try {
                    const prompt = safeArgs.prompt || 'Describe this image in detail, including main subject, colors, atmosphere, expressions, and any text visible.';
                    const imageUrl = safeArgs.image_url;
                    const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + apiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'agnes-2.5-flash',
                            messages: [
                                {
                                    role: 'user',
                                    content: [
                                        { type: 'text', text: prompt },
                                        { type: 'image_url', image_url: { url: imageUrl } }
                                    ]
                                }
                            ],
                            max_tokens: 1024
                        })
                    });
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Agnes API 返回错误 (${response.status}): ${errText.substring(0, 200)}`);
                    }
                    const data = await response.json();
                    const description = data.choices?.[0]?.message?.content || '未能解析出描述内容';
                    text = '������️ **图片识别结果**\n\n' + description;
                } catch (e) {
                    text = '❌ 图片识别失败：' + e.message;
                }
            }
        }
    }
    // ============================================================
    // generate_image - 文生图
    // ============================================================
    else if (name === 'generate_image') {
        if (!safeArgs.prompt) {
            text = '❌ 缺少参数：需要 prompt（图片描述）';
        } else {
            const apiKey = env.AGNES_API_KEY;
            if (!apiKey) {
                text = '❌ 请设置环境变量 AGNES_API_KEY';
            } else {
                try {
                    const size = safeArgs.size || '1024x768';
                    const response = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + apiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'agnes-image-2.1-flash',
                            prompt: safeArgs.prompt,
                            size: size,
                            n: 1
                        })
                    });
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Agnes API 返回错误 (${response.status}): ${errText.substring(0, 200)}`);
                    }
                    const data = await response.json();
                    const imageUrl = data.data?.[0]?.url || '未能获取图片链接';
                    text = '������️ **图片生成成功**\n\n' +
                        '������ 提示词：' + safeArgs.prompt + '\n' +
                        '������ 尺寸：' + size + '\n' +
                        '������ 图片链接：' + imageUrl;
                } catch (e) {
                    text = '❌ 图片生成失败：' + e.message;
                }
            }
        }
    }
    // ============================================================
    // generate_video - 视频生成
    // ============================================================
    else if (name === 'generate_video') {
        if (!safeArgs.prompt) {
            text = '❌ 缺少参数：需要 prompt（视频描述）';
        } else {
            const apiKey = env.AGNES_API_KEY;
            if (!apiKey) {
                text = '❌ 请设置环境变量 AGNES_API_KEY';
            } else {
                try {
                    const mode = safeArgs.mode || 'text';
                    const num_frames = safeArgs.num_frames || 121;
                    const frame_rate = safeArgs.frame_rate || 24;
                    const height = safeArgs.height || 768;
                    const width = safeArgs.width || 1152;
                    let requestBody = {
                        model: 'agnes-video-v2.0',
                        prompt: safeArgs.prompt,
                        num_frames: num_frames,
                        frame_rate: frame_rate
                    };
                    if (mode === 'image') {
                        if (!safeArgs.image) {
                            text = '❌ 图生视频模式需要 image 参数';
                            return text;
                        }
                        requestBody.image = safeArgs.image;
                    } else if (mode === 'keyframes') {
                        if (!safeArgs.images || !Array.isArray(safeArgs.images) || safeArgs.images.length < 2) {
                            text = '❌ 关键帧模式需要 images 数组，至少 2 张图片';
                            return text;
                        }
                        requestBody.extra_body = {
                            image: safeArgs.images,
                            mode: 'keyframes'
                        };
                    } else {
                        requestBody.height = height;
                        requestBody.width = width;
                    }
                    const response = await fetch('https://apihub.agnes-ai.com/v1/videos', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + apiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Agnes API 返回错误 (${response.status}): ${errText.substring(0, 200)}`);
                    }
                    const data = await response.json();
                    const modeText = {
                        'text': '������ 文生视频',
                        'image': '������️ 图生视频',
                        'keyframes': '������️ 关键帧插值'
                    }[mode] || '������ 视频生成';
                    let resultText = modeText + '\n\n' +
                        '������ 提示词：' + safeArgs.prompt + '\n' +
                        '������️ 帧数：' + num_frames + '\n' +
                        '⚡ 帧率：' + frame_rate + ' fps\n';
                    if (mode === 'image' && safeArgs.image) {
                        resultText += '������️ 参考图：' + safeArgs.image + '\n';
                    } else if (mode === 'keyframes' && safeArgs.images) {
                        resultText += '������️ 关键帧数量：' + safeArgs.images.length + '\n';
                    } else {
                        resultText += '������ 分辨率：' + width + 'x' + height + '\n';
                    }
                    const videoId = data.id || data.video_id || data.task_id;
                    const videoUrl = data.url || data.video_url || data.output_url;
                    if (videoUrl) {
                        resultText += '������ 视频链接：' + videoUrl + '\n';
                    }
                    if (videoId) {
                        resultText += '������ 任务ID：' + videoId + '（可用于查询生成进度）';
                    }
                    text = resultText;
                } catch (e) {
                    text = '❌ 视频生成失败：' + e.message;
                }
            }
        }
    }
    // ============================================================
    // help - 工具说明书（从 Supabase 动态读取）
    // ============================================================
    else if (name === 'help') {
        const toolName = safeArgs.tool_name;
        
        // 从 Supabase 获取所有技能
        const skills = await getEnabledSkills(env);
        
        // 构建 toolHelp 映射（从 skills 表生成）
        const toolHelp = {};
        for (const s of skills) {
            toolHelp[s.name] = s.description;
        }
        
        // 按分类分组（从 skills 表读取分类）
        const categories = {};
        for (const s of skills) {
            const cat = s.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(s.name);
        }
        
        if (toolName && toolHelp[toolName]) {
            // 查找该工具是否有额外说明
            const extraHelp = {
                'remember': '\n用法：remember(key, value)\n- key: 记忆标题，支持"分类/标题"格式\n- value: 记忆内容',
                'recall': '\n用法：recall(key, offset, chunk_size)\n- key: 记忆标题\n- offset: 起始位置（可选）\n- chunk_size: 每段字符数（可选，默认5000）',
                'github_push': '\n用法：github_push(path, content, message, branch)\n- path: 文件路径\n- content: 文件内容\n- message: 提交信息（可选）\n- branch: 分支名（可选，默认main）',
                'github_create_repo': '\n用法：github_create_repo(repo, description, private)\n- repo: 仓库名称\n- description: 仓库描述（可选）\n- private: 是否私有（可选）'
            };
            text = `������ **${toolName}**\n${toolHelp[toolName]}${extraHelp[toolName] || ''}`;
        } else if (toolName) {
            text = `❌ 未找到工具 "${toolName}"\n\n可用工具：${Object.keys(toolHelp).join('、')}`;
        } else {
            let lines = '������ **Ziven MCP 工具说明书**\n\n';
            const totalTools = Object.keys(toolHelp).length;
            lines += `������ 总共有 ${totalTools} 个工具\n\n`;
            
            // 按分类显示
            const sortedCats = Object.keys(categories).sort();
            for (const cat of sortedCats) {
                lines += `**${cat}**\n`;
                for (const t of categories[cat]) {
                    const desc = toolHelp[t]?.substring(0, 60) || '';
                    lines += `  - \`${t}\`: ${desc}${desc.length >= 60 ? '...' : ''}\n`;
                }
                lines += '\n';
            }
            lines += '������ 查看某个工具的详细用法：help(工具名)';
            text = lines;
        }
    }
    return text;
}
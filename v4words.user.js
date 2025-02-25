// ==UserScript==
// @name         v4Words - 划词翻译 Userscript
// @namespace    https://github.com/vlan20/v4words
// @version      0.1.0
// @description  v4Words - 更便捷的划词翻译，双击即译，支持谷歌翻译、有道词典及剑桥词典，适配Tampermonkey等脚本管理器。
// @author       vlan20
// @license      MIT
// @match        *://*/*
// @exclude      *://translate.google.com/*
// @exclude      *://dict.youdao.com/*
// @exclude      *://dictionary.cambridge.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      translate.googleapis.com
// @connect      dict.youdao.com
// @connect      dictionary.cambridge.org
// @run-at       document-end
// @downloadURL  https://github.com/vlan20/v4words/raw/main/v4words.user.js
// @updateURL    https://github.com/vlan20/v4words/raw/main/v4words.user.js
// @supportURL   https://github.com/vlan20/v4words/issues
// ==/UserScript==

/*
MIT License

Copyright (c) 2025 vlan20

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(() => {
    'use strict';

    // 配置项
    const CONFIG = {
        fontSize: 16, // 基础字体大小
        sourceFontSize: 14, // 原文字体大小
        translationFontSize: 13, // 翻译结果字体大小
        panelWidth: 300,
        panelHeight: 400,
        triggerDelay: 150, // 减少触发延迟
        doubleClickDelay: 250, // 减少双击延迟
        selectionOverrideDelay: 400, // 减少选择覆盖延迟
        darkModeClass: 'translator-panel-dark',
        panelSpacing: 12, // 减小面板间距
        maxPanelHeight: 400,
        titleBarHeight: 40, // 添加标题栏高度配置
        animationDuration: 200, // 添加动画持续时间配置
        currentTranslator: GM_getValue('defaultTranslator', 'youdao'), // 从GM_getValue读取默认翻译器
        cacheExpiration: 24 * 60 * 60 * 1000, // 缓存过期时间（24小时）
        maxCacheSize: 100, // 最大缓存条目数
    };

    // 全局变量
    let currentPanel = null;
    let isTranslating = false;

    // 翻译缓存系统
    const translationCache = {
        cache: new Map(),

        // 生成缓存键
        generateKey(text, translator) {
            return `${translator}:${text}`;
        },

        // 获取缓存
        get(text, translator) {
            const key = this.generateKey(text, translator);
            const item = this.cache.get(key);
            if (!item) return null;

            // 检查是否过期
            if (Date.now() - item.timestamp > CONFIG.cacheExpiration) {
                this.cache.delete(key);
                return null;
            }

            return item.translation;
        },

        // 设置缓存
        set(text, translator, translation) {
            const key = this.generateKey(text, translator);

            // 如果缓存已满，删除最旧的条目
            if (this.cache.size >= CONFIG.maxCacheSize) {
                const oldestKey = Array.from(this.cache.entries())
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
                this.cache.delete(oldestKey);
            }

            this.cache.set(key, {
                translation,
                timestamp: Date.now()
            });
        },

        // 清除过期缓存
        cleanup() {
            const now = Date.now();
            for (const [key, item] of this.cache.entries()) {
                if (now - item.timestamp > CONFIG.cacheExpiration) {
                    this.cache.delete(key);
                }
            }
        }
    };

    // 定期清理过期缓存
    setInterval(() => translationCache.cleanup(), CONFIG.cacheExpiration);

    // 清理函数
    function cleanupPanels() {
        const panels = document.querySelectorAll('.translator-panel');
        panels.forEach(panel => {
            // 不清理固定的面板
            if (panel !== currentPanel && !panel.classList.contains('pinned')) {
                panel.remove();
            }
        });
    }

    // 创建翻译面板前的检查
    function beforeCreatePanel() {
        cleanupPanels();
        // 只有当当前面板不是固定状态时才移除
        if (currentPanel && !currentPanel.classList.contains('pinned')) {
            currentPanel.remove();
            currentPanel = null;
        }
        // 从存储中获取默认翻译器
        CONFIG.currentTranslator = GM_getValue('defaultTranslator', 'google');
    }

    // 添加音频播放功能
    const audio = {
        // 音频元素缓存
        element: null,

        // 获取音频元素
        getElement() {
            if (!this.element) {
                this.element = document.createElement('audio');
                this.element.style.display = 'none';
                document.body.appendChild(this.element);
            }
            return this.element;
        },

        // 播放音频
        async play(url) {
            try {
                const audioElement = this.getElement();
                audioElement.src = url;
                await audioElement.play();
            } catch (error) {
                console.error('播放音频失败:', error);
            }
        }
    };

    // 翻译器工厂函数
    const createTranslator = (name, translateFn) => ({
        name,
        translate: async (text) => {
            // 检查缓存
            const cachedResult = translationCache.get(text, name);
            if (cachedResult) {
                console.log(`[${name}] 使用缓存的翻译结果`);
                return cachedResult;
            }

            // 如果没有缓存，执行翻译
            const result = await translateFn(text);
            if (!result) throw new Error(`${name}翻译失败: 翻译结果为空`);

            // 缓存结果
            translationCache.set(text, name, result);

            return result;
        }
    });

    // 翻译器配置
    const TRANSLATORS = {
        google: createTranslator('谷歌翻译', async (text) => {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`,
                        onload: resolve,
                        onerror: reject,
                    });
                });
                const result = JSON.parse(response.responseText);
                return result[0].map(x => x[0]).join('');
        }),

        youdao: createTranslator('有道词典', async (text) => {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://dict.youdao.com/jsonapi?xmlVersion=5.1&jsonversion=2&q=${encodeURIComponent(text)}`,
                        headers: {
                            'Referer': 'https://dict.youdao.com',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        onload: resolve,
                        onerror: reject,
                    });
                });
                const result = JSON.parse(response.responseText);
                let translation = '';
                let audioUrls = {uk: '', us: ''};

                // 获取发音URL
                if (result.ec?.word?.[0]) {
                    const word = result.ec.word[0];
                audioUrls = {
                    uk: word.ukspeech ? `https://dict.youdao.com/dictvoice?audio=${word.ukspeech}` : '',
                    us: word.usspeech ? `https://dict.youdao.com/dictvoice?audio=${word.usspeech}` : ''
                };
                }

                // 添加音标和发音按钮
                if (result.ec?.word?.[0]?.ukphone || result.ec?.word?.[0]?.usphone) {
                const {ukphone, usphone} = result.ec.word[0];
                        translation += '<div class="phonetic-buttons">';
                if (ukphone) translation += `<span class="phonetic-item">英 /${ukphone}/ <button class="audio-button" data-url="${audioUrls.uk}">🔊</button></span>`;
                if (usphone) translation += `<span class="phonetic-item">美 /${usphone}/ <button class="audio-button" data-url="${audioUrls.us}">🔊</button></span>`;
                        translation += '</div>\n\n';
                }

            // 获取翻译结果
                if (result.ec?.word?.[0]?.trs) {
                translation += result.ec.word[0].trs.map(tr => tr.tr[0].l.i.join('; ')).join('\n');
            } else if (result.fanyi) {
                    translation = result.fanyi.tran;
            } else if (result.translation) {
                    translation = result.translation.join('\n');
            } else if (result.web_trans?.web_translation) {
                    translation = result.web_trans.web_translation
                        .map(item => item.trans.map(t => t.value).join('; '))
                        .join('\n');
                }

            if (!translation) throw new Error('未找到翻译结果');
                return translation;
        }),

        cambridge: createTranslator('剑桥词典', async (text) => {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://dictionary.cambridge.org/search/english-chinese-simplified/direct/?q=${encodeURIComponent(text)}`,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.5',
                        },
                        onload: resolve,
                        onerror: reject,
                    });
                });

                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, 'text/html');
                let translation = '';

                // 创建词性标签HTML的辅助函数
                const createPosTagsHtml = (posStr) => {
                    if (!posStr) return '';
                    const tags = posStr.split(/[,，、\n]/)
                        .map(p => p.trim())
                        .filter(p => p);
                    return tags.map(tag => `<div class="pos-tag">${tag}</div>`).join('');
                };

                // 获取音标和发音URL
                const getFullUrl = url => url ? (url.startsWith('http') ? url : url.startsWith('//') ? 'https:' + url : `https://dictionary.cambridge.org${url}`) : '';

                // 获取所有发音信息
                const getPronunciations = (container) => {
                    const prons = Array.from(container.querySelectorAll('.pron')).map(el => el.textContent.trim());
                    const audioUrls = Array.from(container.querySelectorAll('source[type="audio/mpeg"]')).map(el => getFullUrl(el.getAttribute('src')));
                    return { prons, audioUrls };
                };

                // 获取主要发音（顶部）
                const mainUkContainer = doc.querySelector('.uk.dpron-i');
                const mainUsContainer = doc.querySelector('.us.dpron-i');
                const mainUk = mainUkContainer ? getPronunciations(mainUkContainer) : { prons: [], audioUrls: [] };
                const mainUs = mainUsContainer ? getPronunciations(mainUsContainer) : { prons: [], audioUrls: [] };

                // 添加主音标和发音按钮
                if (mainUk.prons.length > 0 || mainUs.prons.length > 0) {
                    translation += '<div class="phonetic-buttons">';
                    if (mainUk.prons.length > 0) {
                        mainUk.prons.forEach((pron, index) => {
                            translation += `<span class="phonetic-item">英 ${pron} <button class="audio-button" data-url="${mainUk.audioUrls[index]}">🔊</button></span>`;
                        });
                    }
                    if (mainUs.prons.length > 0) {
                        mainUs.prons.forEach((pron, index) => {
                            translation += `<span class="phonetic-item">美 ${pron} <button class="audio-button" data-url="${mainUs.audioUrls[index]}">🔊</button></span>`;
                        });
                    }
                    translation += '</div>\n\n';
                }

                // 获取释义
                const entries = doc.querySelectorAll('.pr.entry-body__el');
                if (entries.length > 0) {
                    translation += Array.from(entries).map(entry => {
                        // 获取所有词性标签，包括多词性的情况
                        const posElements = entry.querySelectorAll('.pos-header .pos');
                        const pos = posElements.length > 0 ?
                            Array.from(posElements)
                                .map(el => el.textContent.trim())
                                .filter((value, index, self) => self.indexOf(value) === index) // 去重
                                .join('\n') :
                            entry.querySelector('.pos')?.textContent.trim() || '';

                        // 获取所有释义组
                        const senseGroups = Array.from(entry.querySelectorAll('.pr.dsense-block')).filter(group =>
                            !group.querySelector('.phrase-title, .idiom-title')
                        );

                        // 如果没有找到释义组，尝试获取单个释义
                        if (senseGroups.length === 0) {
                            const senses = Array.from(entry.querySelectorAll('.ddef_block')).filter(sense =>
                                !sense.closest('.phrase-block, .idiom-block')
                            );
                            return processSenses(senses, pos);
                        }

                        // 处理每个释义组
                        return senseGroups.map(group => {
                            // 获取词性标签和词汇等级
                            const groupPos = group.querySelector('.dsense-header .pos')?.textContent.trim() || pos;
                            const levelTag = group.querySelector('.dsense-header .dxref')?.textContent.trim() || '';

                            // 获取该组下的所有释义
                            const senses = Array.from(group.querySelectorAll('.ddef_block')).filter(sense =>
                                !sense.closest('.phrase-block, .idiom-block')
                            );

                            // 创建词性标签和等级标识的HTML
                            const posHtml = groupPos ? `<div class="sense-block">
                                <div class="pos-tags">
                                    ${createPosTagsHtml(groupPos)}
                                    ${levelTag ? `<div class="level-tag">${levelTag}</div>` : ''}
                                </div>
                            </div>` : '';

                            // 处理释义
                            const sensesHtml = processSenses(senses, groupPos);

                            return `${posHtml}${sensesHtml}`;
                        }).join('\n');
                    }).join('\n');

                    // 获取短语
                    const phrases = doc.querySelectorAll('.phrase-block, .idiom-block');
                    if (phrases.length > 0) {
                        translation += '\n\n';
                        translation += Array.from(phrases).map(phraseBlock => {
                            const phraseTitle = phraseBlock.querySelector('.phrase-title, .idiom-title')?.textContent.trim() || '';
                            const senses = Array.from(phraseBlock.querySelectorAll('.ddef_block'));

                            // 获取短语的定义（不包含例句）
                            const phraseDef = senses[0]?.querySelector('.def')?.textContent.trim() || '';

                            return `<div class="sense-block">
                                <div class="pos-tags">
                                    ${createPosTagsHtml('phrase')}
                                </div>
                                <div class="def-content">
                                    <div class="def-text">${phraseTitle}</div>
                                    <div class="trans-line">${phraseDef}</div>
                                </div>
                            </div>`;
                        }).join('\n');
                    }
                } else {
                    throw new Error('未找到释义');
                }

                function processSenses(senses, pos) {
                        if (senses.length === 0 && pos) {
                            return `<div class="sense-block pos-only">
                            <div class="pos-tags">
                                ${createPosTagsHtml(pos)}
                                </div>
                            </div>`;
                        }

                    return senses.map(sense => {
                        // 获取释义和翻译
                            const def = sense.querySelector('.ddef_h .def')?.textContent.trim() || '';
                        const trans = sense.querySelector('.def-body .trans')?.textContent.trim() || '';
                        // 获取词汇等级
                        const levelTag = sense.querySelector('.dxref')?.textContent.trim() || '';

                        // 获取这个释义下的所有发音
                        let senseProns = '';
                        const sensePronContainers = sense.querySelectorAll('.dpron-i');
                        if (sensePronContainers.length > 0) {
                            // 获取音标和发音按钮
                            let ukContainer, usContainer;
                            Array.from(sensePronContainers).forEach(container => {
                                if (container.classList.contains('uk')) ukContainer = container;
                                else if (container.classList.contains('us')) usContainer = container;
                            });

                            // 获取共享音标（如果存在）
                            const sharedPron = sense.querySelector('.pron')?.textContent.trim();

                            if (sharedPron) {
                                // 如果有共享音标，使用一个音标但两个发音按钮
                                senseProns = '<div class="sense-phonetic">';
                                const ukUrl = ukContainer ? getFullUrl(ukContainer.querySelector('source[type="audio/mpeg"]')?.getAttribute('src')) : '';
                                const usUrl = usContainer ? getFullUrl(usContainer.querySelector('source[type="audio/mpeg"]')?.getAttribute('src')) : '';

                                if (ukUrl || usUrl) {
                                    senseProns += `<span class="phonetic-item">`;
                                    if (ukUrl) senseProns += `英 ${sharedPron} <button class="audio-button" data-url="${ukUrl}">🔊</button>`;
                                    if (usUrl) senseProns += `美 ${sharedPron} <button class="audio-button" data-url="${usUrl}">🔊</button>`;
                                    senseProns += `</span>`;
                                }
                                senseProns += '</div>';
                            } else {
                                // 否则使用分别的音标和发音按钮
                                const ukProns = ukContainer ? getPronunciations(ukContainer) : { prons: [], audioUrls: [] };
                                const usProns = usContainer ? getPronunciations(usContainer) : { prons: [], audioUrls: [] };

                                if (ukProns.prons.length > 0 || usProns.prons.length > 0) {
                                    senseProns = '<div class="sense-phonetic">';
                                    if (ukProns.prons.length > 0) {
                                        ukProns.prons.forEach((pron, index) => {
                                            senseProns += `<span class="phonetic-item">英 ${pron} <button class="audio-button" data-url="${ukProns.audioUrls[index]}">🔊</button></span>`;
                                        });
                                    }
                                    if (usProns.prons.length > 0) {
                                        usProns.prons.forEach((pron, index) => {
                                            senseProns += `<span class="phonetic-item">美 ${pron} <button class="audio-button" data-url="${usProns.audioUrls[index]}">🔊</button></span>`;
                                        });
                                    }
                                    senseProns += '</div>';
                                }
                            }
                        }

                        const template = pos ?
                            `<div class="sense-block">
                                <div class="pos-tags">
                                    ${createPosTagsHtml(pos)}
                                    ${levelTag ? `<div class="level-tag">${levelTag}</div>` : ''}
                                </div>
                                <div class="def-content">
                                    ${senseProns}
                                    <div class="def-text">${def}</div>
                                    ${trans ? `<div class="trans-line">${trans}</div>` : ''}
                                </div>
                            </div>` :
                            `<div class="sense-block no-pos">
                                    <div class="def-content">
                                    ${senseProns}
                                        <div class="def-text">${def}</div>
                                        ${trans ? `<div class="trans-line">${trans}</div>` : ''}
                                    </div>
                                </div>`;
                        return template;
                        }).join('\n');
                }

                return translation;
        })
    };

    // 添加样式
    GM_addStyle(`
        /* ================ */
        /* 1. CSS 变量定义 */
        /* ================ */
        .translator-panel {
            /* 基础颜色 */
            --panel-bg: #ffffff;
            --panel-text: #2c3e50;
            --panel-border: #e2e8f0;
            --panel-shadow: rgba(0,0,0,0.1);

            /* 标题栏颜色 */
            --title-bg: #f8fafc;
            --title-text: #334155;
            --title-border: #e2e8f0;

            /* 次要文本颜色 */
            --text-secondary: #475569;
            --text-tertiary: #64748b;

            /* 交互颜色 */
            --hover-bg: #f1f5f9;
            --active-link: #3b82f6;
            --success: #22c55e;
            --error: #ef4444;

            /* 布局尺寸 */
            --spacing-xs: 2px;
            --spacing-sm: 4px;
            --spacing-md: 6px;
            --spacing-lg: 8px;
            --spacing-xl: 12px;

            /* 字体大小 */
            --font-xs: 10px;
            --font-sm: 12px;
            --font-md: 13px;
            --font-lg: 14px;
            --font-xl: 16px;

            /* 过渡效果 */
            --theme-transition: background-color 0.15s ease-out,
                                background-image 0.15s ease-out,
                                color 0.15s ease-out,
                                border-color 0.15s ease-out,
                                border-bottom-color 0.15s ease-out,
                                box-shadow 0.15s ease-out;
        }

        /* 深色模式变量 */
        .translator-panel.translator-panel-dark {
            --panel-bg: #1a1a1a;
            --panel-text: #e0e0e0;
            --panel-border: #333;
            --panel-shadow: rgba(0,0,0,0.3);

            --title-bg: #2c2c2c;
            --title-text: #e0e0e0;
            --title-border: #333;

            --text-secondary: #999;
            --text-tertiary: #888;

            --hover-bg: rgba(255, 255, 255, 0.1);
            --active-link: #4a9eff;
            --success: #73d13d;
            --error: #ff7875;
        }

        /* ================ */
        /* 2. 基础面板样式 */
        /* ================ */
        .translator-panel {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            font-size: ${CONFIG.fontSize}px !important;
            line-height: 1.5 !important;
            color: var(--panel-text) !important;
            background: var(--panel-bg) !important;
            border: 1px solid var(--panel-border) !important;
            border-radius: 6px !important;
            padding: var(--spacing-md) !important;
            box-shadow: 0 4px 12px var(--panel-shadow) !important;
            max-width: ${CONFIG.panelWidth}px !important;
            position: absolute !important;
            z-index: 2147483647 !important;
            display: none;
            opacity: 0;
            transform: translateY(-10px);
            transition: var(--theme-transition),
                        opacity 0.3s,
                        transform 0.3s !important;
        }

        /* 标题栏禁用文本选择 */
        .translator-panel .title-bar {
            user-select: none !important;
        }

        /* 调整内容区域的内边距和滚动条 */
        .translator-panel .content {
            position: relative !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            height: 100% !important;
        }

        /* 源文本容器样式 */
        .translator-panel .source-text-container {
            position: sticky !important;
            top: 0 !important;
            z-index: 1 !important;
            background: var(--panel-bg) !important;
            border-bottom: 1px solid var(--panel-border) !important;
            margin: calc(-1 * var(--spacing-md)) calc(-1 * var(--spacing-md)) 0 !important;
            padding: var(--spacing-md) var(--spacing-lg) var(--spacing-md) calc(var(--spacing-lg) + var(--spacing-sm)) !important;
            transition: var(--theme-transition) !important;
        }

        /* 源文本样式 */
        .translator-panel .source-text {
            color: var(--text-secondary) !important;
            font-size: ${CONFIG.sourceFontSize}px !important;
            line-height: 1.5 !important;
            user-select: text !important;
        }

        .translator-panel .source-text strong {
            color: var(--panel-text) !important;
            font-weight: 600 !important;
        }

        /* 翻译内容容器样式 */
        .translator-panel .translation-container {
            flex: 1 !important;
            overflow-y: auto !important;
            padding: var(--spacing-md) var(--spacing-md) !important;
        }

        /* 翻译结果样式 */
        .translator-panel .translation {
            color: var(--panel-text) !important;
            font-size: ${CONFIG.translationFontSize}px !important;
            line-height: 1.5 !important;
            user-select: text !important;
        }

        /* 深色模式下的源文本样式调整 */
        .translator-panel.translator-panel-dark .source-text strong {
            color: #fff !important;
        }

        /* 调整滚动条样式 */
        .translator-panel .translation-container::-webkit-scrollbar {
            width: 4px !important;
            height: 4px !important;
        }

        .translator-panel .translation-container::-webkit-scrollbar-thumb {
            background: var(--text-tertiary) !important;
            border-radius: 4px !important;
            transition: background-color 0.2s !important;
        }

        .translator-panel .translation-container::-webkit-scrollbar-thumb:hover {
            background: var(--text-secondary) !important;
        }

        .translator-panel .translation-container::-webkit-scrollbar-track {
            background: var(--hover-bg) !important;
            border-radius: 4px !important;
        }

        /* 确保词性标签和音标也可以选择 */
        .translator-panel .pos-tag,
        .translator-panel .phonetic-item {
            user-select: text !important;
        }

        /* 调整释义块样式 */
        .translator-panel .sense-block {
            margin: var(--spacing-sm) 0 !important;
            padding: var(--spacing-sm) 0 !important;
            display: flex !important;
            gap: var(--spacing-lg) !important;
            align-items: flex-start !important;
            border-bottom: 1px solid var(--panel-border) !important;
            transition: var(--theme-transition) !important;
        }

        .sense-block:first-child {
            margin-top: 0 !important;
        }

        .sense-block:last-child {
            margin-bottom: 0 !important;
            border-bottom: none !important;
        }

        /* 调整音标项样式 */
        .phonetic-item {
            display: flex !important;
            align-items: center !important;
            gap: var(--spacing-sm) !important;
            color: var(--text-secondary) !important;
            padding: var(--spacing-xs) var(--spacing-sm) !important;
            white-space: nowrap !important;
        }

        /* 基础重置样式 */
        .translator-panel * {
            all: revert;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
            font-family: inherit !important;
            line-height: inherit !important;
            color: inherit !important;
            pointer-events: auto !important;
        }

        /* ================ */
        /* 3. 布局组件样式 */
        /* ================ */

        /* 标题栏 */
        .translator-panel .title-bar {
            position: relative !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            border-bottom: 1px solid var(--title-border) !important;
            padding: var(--spacing-xs) var(--spacing-md) !important;
            margin: calc(-1 * var(--spacing-md)) calc(-1 * var(--spacing-md)) var(--spacing-md) calc(-1 * var(--spacing-md)) !important;
            background-color: var(--title-bg) !important;
            border-top-left-radius: 6px !important;
            border-top-right-radius: 6px !important;
            gap: var(--spacing-md) !important;
            cursor: move !important;
            transition: var(--theme-transition) !important;
        }

        /* 标题包装器和按钮基础样式 */
        .translator-panel .title-wrapper,
        .translator-panel .theme-button,
        .translator-panel .pin-button,
        .translator-panel .clear-button,
        .translator-panel .external-button {
            display: flex !important;
            align-items: center !important;
            cursor: pointer !important;
            transition: all 0.2s !important;
        }

        /* 标题包装器特有样式 */
        .translator-panel .title-wrapper {
            gap: var(--spacing-sm) !important;
            padding: var(--spacing-xs) var(--spacing-lg) !important;
            border-radius: var(--spacing-sm) !important;
            min-width: 120px !important;
            max-width: 200px !important;
            margin-right: auto !important;
        }

        .translator-panel .title-wrapper:hover {
            background-color: var(--hover-bg) !important;
        }

        /* 按钮共享样式 */
        .translator-panel .theme-button,
        .translator-panel .pin-button,
        .translator-panel .clear-button,
        .translator-panel .external-button {
            width: var(--font-xl) !important;
            height: var(--font-xl) !important;
            justify-content: center !important;
            font-size: var(--font-lg) !important;
            opacity: 0.6 !important;
            display: flex !important;
            align-items: center !important;
        }

        .translator-panel .theme-button:hover,
        .translator-panel .pin-button:hover,
        .translator-panel .clear-button:hover,
        .translator-panel .external-button:hover {
            opacity: 1 !important;
        }

        /* 按钮图标 */
        .translator-panel .pin-button::after {
            content: "" !important;
            display: inline-block !important;
            width: 16px !important;
            height: 16px !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
        }
        .translator-panel .pin-button.unpinned::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M12 12v9"/></svg>') !important;
        }
        .translator-panel .pin-button.pinned::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4" fill="currentColor"/><path d="M12 12v9"/></svg>') !important;
        }
        .translator-panel.translator-panel-dark .pin-button.unpinned::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M12 12v9"/></svg>') !important;
        }
        .translator-panel.translator-panel-dark .pin-button.pinned::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4" fill="%23ffffff"/><path d="M12 12v9"/></svg>') !important;
        }
        .translator-panel .theme-button::after {
            content: "" !important;
            display: inline-block !important;
            width: 16px !important;
            height: 16px !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
        }
        .translator-panel .theme-button.light::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>') !important;
        }
        .translator-panel .theme-button.dark::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>') !important;
        }
        .translator-panel .clear-button::after {
            content: "" !important;
            display: inline-block !important;
            width: 16px !important;
            height: 16px !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M3 21l18-18M12 12v.01"/></svg>') !important;
        }
        .translator-panel.translator-panel-dark .clear-button::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M3 21l18-18M12 12v.01"/></svg>') !important;
        }
        .translator-panel .external-button::after {
            content: "" !important;
            display: inline-block !important;
            width: 16px !important;
            height: 16px !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>') !important;
        }
        .translator-panel.translator-panel-dark .external-button::after {
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>') !important;
        }

        /* 下拉菜单基础样式 */
        .translator-panel .dropdown-menu {
            position: absolute !important;
            left: 0 !important;
            right: 0 !important;
            background: var(--panel-bg) !important;
            border: 1px solid var(--panel-border) !important;
            border-radius: var(--spacing-sm) !important;
            box-shadow: 0 2px 8px var(--panel-shadow) !important;
            padding: var(--spacing-sm) 0 !important;
            width: auto !important;
            min-width: 120px !important;
            max-height: 200px !important;
            overflow-y: auto !important;
            z-index: 1 !important;
            display: none !important;
            transition: var(--theme-transition) !important;
        }

        /* 下拉菜单显示状态 */
        .translator-panel .dropdown-menu.show {
            display: block !important;
        }

        /* 下拉菜单项样式 */
        .translator-panel .dropdown-item {
            padding: var(--spacing-md) var(--spacing-xl) !important;
            cursor: pointer !important;
            font-size: var(--font-sm) !important;
            color: var(--panel-text) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            white-space: nowrap !important;
            position: relative !important;
        }

        .translator-panel .dropdown-item:hover {
            background-color: var(--hover-bg) !important;
        }

        .translator-panel .dropdown-item .translator-name {
            display: flex !important;
            align-items: center !important;
            gap: var(--spacing-sm) !important;
        }

        .translator-panel .dropdown-item.active .translator-name {
            font-weight: 600 !important;
        }

        .translator-panel .dropdown-item.is-default .translator-name::after {
            content: '（默认）' !important;
            font-weight: 600 !important;
            margin-left: var(--spacing-sm) !important;
            color: var(--text-tertiary) !important;
        }

        .translator-panel .dropdown-item .set-default {
            opacity: 0 !important;
            transition: all 0.2s !important;
            color: var(--text-tertiary) !important;
            padding: var(--spacing-xs) var(--spacing-sm) !important;
            border-radius: var(--spacing-xs) !important;
            font-size: var(--font-xs) !important;
        }

        .translator-panel .dropdown-item:hover .set-default {
            opacity: 1 !important;
        }

        .translator-panel .dropdown-item .set-default:hover {
            color: var(--active-link) !important;
            background-color: var(--hover-bg) !important;
        }

        .translator-panel .dropdown-item.is-default .set-default {
            display: none !important;
        }

        /* 文本样式 */
        .translator-panel .title {
            font-size: var(--font-sm) !important;
            font-weight: 500 !important;
            color: var(--title-text) !important;
            white-space: nowrap !important;
        }

        .translator-panel .switch-text {
            font-size: var(--font-sm) !important;
            color: var(--text-tertiary) !important;
            opacity: 0.8 !important;
            white-space: nowrap !important;
        }

        /* 错误状态 */
        .translator-panel .error {
            padding: var(--spacing-xl) 0 !important;
            text-align: center !important;
            font-size: var(--font-sm) !important;
            color: var(--error) !important;
        }

        /* 发音按钮样式 */
        .phonetic-buttons {
            margin: 0 0 var(--spacing-sm) 0 !important;
            display: flex !important;
            gap: var(--spacing-xl) !important;
            flex-wrap: wrap !important;
            padding: 0 !important;
        }

        .audio-button {
            border: none;
            background: none;
            cursor: pointer;
            padding: var(--spacing-xs) var(--spacing-sm);
            font-size: var(--font-xl);
            color: var(--active-link);
            transition: all 0.3s;
            border-radius: var(--spacing-xs);
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .audio-button:hover {
            background-color: var(--hover-bg);
        }

        .audio-button:active {
            transform: scale(0.95);
        }

        /* 词性标签容器样式 */
        .translator-panel .pos-tags {
            display: flex !important;
            flex-direction: column !important;
            gap: var(--spacing-xs) !important;
            min-width: 35px !important;
            flex-shrink: 0 !important;
            align-items: center !important;
        }

        /* 词性标签样式 */
        .translator-panel .pos-tag {
            font-weight: 500 !important;
            color: #fff !important;
            padding: var(--spacing-xs) var(--spacing-sm) !important;
            border-radius: var(--spacing-xs) !important;
            font-size: var(--font-sm) !important;
            text-align: center !important;
            width: 100% !important;
            margin-bottom: 0 !important;
            background: var(--pos-color, #6b7280) !important;
        }

        /* 词汇等级标识样式 */
        .translator-panel .level-tag {
            font-size: var(--font-xs) !important;
            padding: var(--spacing-xs) var(--spacing-sm) !important;
            border-radius: 3px !important;
            text-align: center !important;
            min-width: 24px !important;
            margin-top: 2px !important;
            font-weight: 500 !important;
            letter-spacing: 0.5px !important;
        }

        /* 调整释义块样式 */
        .translator-panel .sense-block {
            margin: var(--spacing-sm) 0 !important;
            padding: var(--spacing-sm) 0 !important;
            display: flex !important;
            gap: var(--spacing-lg) !important;
            align-items: flex-start !important;
            border-bottom: 1px solid var(--panel-border) !important;
            transition: var(--theme-transition) !important;
        }

        /* 调整词性标签和释义内容的布局 */
        .translator-panel .def-content {
            flex: 1 !important;
            min-width: 0 !important;
        }

        /* 动画效果 */
        .translator-panel.show {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }

        .translator-panel.active {
            display: block !important;
            opacity: 1 !important;
            transform: translateY(0) !important;
        }

        /* 添加释义发音样式 */
        .translator-panel .sense-phonetic {
            margin-bottom: var(--spacing-sm) !important;
            opacity: 0.8 !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: var(--spacing-xl) !important;
        }

        .translator-panel .sense-phonetic .phonetic-item {
            font-size: var(--font-sm) !important;
            color: var(--text-secondary) !important;
            flex: 0 1 auto !important;
        }

        .translator-panel .sense-phonetic .audio-button {
            font-size: var(--font-lg) !important;
            padding: var(--spacing-xs) !important;
        }
    `);

    // 状态管理
    const state = {
        currentText: '',
        isDragging: false,
        lastClickTime: 0,
        clickCount: 0,
        ignoreNextSelection: false,
        allPanels: new Set(),
        pinnedPanels: new Set(),
        activePanel: null,
        isSelectingInPanel: false,
        selectingPanel: null,
        isRightClickPending: false // 添加右键状态跟踪
    };

    // 工具函数
    const utils = {
        // HTML 转义映射
        escapeMap: {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'},
        escapeHtml: text => text.replace(/[&<>"']/g, c => utils.escapeMap[c]),

        // 主题相关
        isDarkMode: () => GM_getValue('darkMode', false),
        toggleDarkMode() {
            const isDark = !GM_getValue('darkMode', false);
            GM_setValue('darkMode', isDark);
            document.querySelectorAll('.translator-panel').forEach(panel => {
                panel.classList.toggle(CONFIG.darkModeClass, isDark);
                panel.querySelector('.theme-button').className = `theme-button ${isDark ? 'dark' : 'light'}`;
            });
        },

        // 防抖函数
        debounce(fn, delay) {
            let timer;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },

        // 事件处理
        addEventHandler(element, eventType, handler, options = {}) {
            if (!element || !eventType || !handler) return;

            // 先移除旧的事件处理器
            if (element[`${eventType}Handler`]) {
                element.removeEventListener(eventType, element[`${eventType}Handler`]);
            }

            // 保存新的事件处理器引用
            element[`${eventType}Handler`] = handler;

            // 添加新的事件处理器
            element.addEventListener(eventType, handler, options);
        },

        removeEventHandler(element, eventType) {
            if (!element || !eventType) return;

            const handler = element[`${eventType}Handler`];
            if (handler) {
                element.removeEventListener(eventType, handler);
                delete element[`${eventType}Handler`];
            }
        },

        removeAllEventHandlers(element) {
            if (!element) return;

            const eventTypes = ['click', 'mousedown', 'mouseup', 'mousemove', 'mouseleave', 'mouseenter'];
            eventTypes.forEach(eventType => this.removeEventHandler(element, eventType));
        },

        // DOM 操作
        createElement(tag, attributes = {}, children = []) {
            const element = document.createElement(tag);
            Object.entries(attributes).forEach(([key, value]) =>
                key === 'style' && typeof value === 'object' ?
                    Object.assign(element.style, value) :
                    element.setAttribute(key, value)
            );
            children.forEach(child => element.appendChild(
                typeof child === 'string' ? document.createTextNode(child) : child
            ));
            return element;
        },

        // 错误处理
        setError(message, targetPanel) {
            const content = targetPanel?.querySelector('.content');
            if (content) content.innerHTML = `<div class="error">${message}</div>`;
        },

        // 面板显示
        showPanel(x, y, targetPanel = panel) {
            if (targetPanel.style.display === 'block') {
                targetPanel.classList.add('show');
                return;
            }

            const {innerWidth: vw, innerHeight: vh} = window;
            const {pageXOffset: sx, pageYOffset: sy} = window;
            const spacing = CONFIG.panelSpacing;

            // 计算面板的水平位置
            const panelX = Math.max(
                spacing + sx,
                Math.min(sx + vw - CONFIG.panelWidth - spacing, x)
            );

            // 计算可用的最大高度
            const maxAvailableHeight = Math.min(
                CONFIG.maxPanelHeight,
                vh - 2 * spacing // 减去上下间距
            );

            // 更新配置中的实际最大高度
            const actualMaxHeight = maxAvailableHeight;
            const contentMaxHeight = actualMaxHeight - CONFIG.titleBarHeight - 2 * CONFIG.panelSpacing;

            // 计算面板的垂直位置
            const spaceBelow = vh - (y - sy);
            const spaceAbove = y - sy;

            // 确定面板显示位置（上方或下方）
            const panelY = spaceBelow >= actualMaxHeight || spaceBelow >= spaceAbove ?
                // 显示在下方
                Math.min(y + spacing, sy + vh - actualMaxHeight - spacing) :
                // 显示在上方
                Math.max(sy + spacing, y - actualMaxHeight - spacing);

            // 设置面板样式
            Object.assign(targetPanel.style, {
                position: 'absolute',
                left: `${panelX}px`,
                top: `${panelY}px`,
                maxHeight: `${actualMaxHeight}px`,
                display: 'block'
            });

            // 设置内容区域的最大高度
            const content = targetPanel.querySelector('.content');
            if (content) {
                content.style.maxHeight = `${contentMaxHeight}px`;
            }

            targetPanel.classList.toggle(CONFIG.darkModeClass, this.isDarkMode());
            setTimeout(() => targetPanel.classList.add('show'), 50);
        },

        // 面板隐藏
        hidePanel(targetPanel = panel) {
            if (!targetPanel || state.pinnedPanels.has(targetPanel)) return;
            targetPanel.classList.remove('show');
            setTimeout(() => {
                if (!targetPanel.classList.contains('show')) {
                    targetPanel.style.display = 'none';
                }
            }, CONFIG.animationDuration);
            if (targetPanel === state.activePanel) state.activePanel = null;
        },

        // 元素检查
        isInvalidElement: element => {
            try {
                return element && element instanceof Element && (
                    ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName) ||
                element.isContentEditable ||
                    element.closest('[contenteditable]')
                );
            } catch (error) {
                console.error('检查元素有效性时出错:', error);
                return false;
            }
        },

        // 文本检查
        isTranslatable(text) {
            const trimmedText = text.trim().replace(/\s+/g, '');
            if (!trimmedText) return false;
            if (/[a-zA-Z]/.test(trimmedText)) return true;

            const chinesePattern = /[\u4e00-\u9fff]/;
            const nonChinesePattern = /[^\u4e00-\u9fff\d\s\p{P}\p{S}]/u;

            if (chinesePattern.test(trimmedText) && !nonChinesePattern.test(trimmedText)) return false;
            if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmedText)) return false;

            return true;
        },

        // 面板管理
        createNewPanel() {
            const newPanel = panel.cloneNode(true);
            newPanel.style.display = 'none';
            document.body.appendChild(newPanel);
            state.allPanels.add(newPanel);
            setupPanelEvents(newPanel);
            return newPanel;
        },

        getOrCreatePanel() {
            if (state.activePanel && !state.pinnedPanels.has(state.activePanel)) {
                return state.activePanel;
            }

            const availablePanel = Array.from(state.allPanels)
                .find(panel => !state.pinnedPanels.has(panel) && panel.style.display !== 'block');

            if (availablePanel) {
                state.activePanel = availablePanel;
                return availablePanel;
            }

            state.activePanel = this.createNewPanel();
            return state.activePanel;
        },

        // 点击检查
        isClickInPanel: e => e.target.closest('.translator-panel') !== null,

        // 选择触发控制
        preventSelectionTrigger() {
            state.ignoreNextSelection = true;
            setTimeout(() => {
                state.ignoreNextSelection = false;
            }, 100);
        },

        // 翻译器状态更新
        updateAllPanels(newTranslator, isDefaultUpdate = false) {
            const defaultTranslator = GM_getValue('defaultTranslator', 'google');

            // 只在非默认更新时才更改当前翻译器
            if (!isDefaultUpdate) {
                CONFIG.currentTranslator = newTranslator;
            }

            document.querySelectorAll('.translator-panel').forEach(panel => {
                // 只在非默认更新时才更改标题
                if (!isDefaultUpdate) {
                panel.querySelector('.title').textContent = TRANSLATORS[newTranslator].name;
                }

                panel.querySelectorAll('.dropdown-item').forEach(item => {
                    const key = item.dataset.translator;
                    const isDefault = key === defaultTranslator;
                    const isActive = key === CONFIG.currentTranslator;

                    item.className = `dropdown-item${isActive ? ' active' : ''}${isDefault ? ' is-default' : ''}`;

                    const nameSpan = item.querySelector('.translator-name');
                    if (nameSpan) nameSpan.innerHTML = `${isActive ? '✓ ' : ''}${TRANSLATORS[key].name}`;

                    const defaultSpan = item.querySelector('.set-default');
                    if (defaultSpan) {
                        defaultSpan.textContent = isDefault ? '默认' : '设为默认';
                        if (isDefaultUpdate && isDefault) {
                            defaultSpan.classList.add('animating');
                            setTimeout(() => defaultSpan.classList.remove('animating'), 500);
                        }
                    }
                });
            });
        },

        // 面板清理
        cleanupPanel(targetPanel) {
            if (!targetPanel) return;

            // 移除所有事件监听器
            utils.removeAllEventHandlers(targetPanel);

            // 从 DOM 中移除面板
            targetPanel.remove();
        }
    };

    // 翻译功能
    async function translate(text, targetPanel = panel) {
        if (!text || !targetPanel) {
            console.error('翻译参数无效:', { text, targetPanel });
            throw new Error('翻译参数无效');
        }

        const textToTranslate = text.replace(/\n\s*\n/g, '\n\n')
                                .replace(/\s*\n\s*/g, '\n')
                                .trim();

        if (!textToTranslate) {
            throw new Error('翻译文本为空');
        }

        const translator = TRANSLATORS[CONFIG.currentTranslator];
        if (!translator) {
            throw new Error('未找到指定的翻译器');
        }

        const formattedTranslation = await translator.translate(textToTranslate);
        if (!formattedTranslation) {
            throw new Error('翻译结果为空');
        }

        const content = targetPanel.querySelector('.content');
        if (!content) {
            throw new Error('未找到内容容器元素');
        }

        content.innerHTML = `
            <div class="source-text-container">
                <div class="source-text"><strong>${utils.escapeHtml(textToTranslate).replace(/\n/g, '<br>')}</strong></div>
            </div>
            <div class="translation-container">
                <div class="translation">${formattedTranslation}</div>
            </div>`;

        // 添加音频按钮点击事件
        try {
            targetPanel.querySelectorAll('.audio-button').forEach(button => {
                button.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = button.getAttribute('data-url');
                    if (url) {
                        try {
                            // 阻止选择触发
                            utils.preventSelectionTrigger();
                            // 重置选择状态
                            state.isSelectingInPanel = false;
                            state.selectingPanel = null;
                            // 播放音频
                            await audio.play(url);
                        } catch (error) {
                            console.error('播放音频失败:', error);
                            utils.setError('音频播放失败', targetPanel);
                        }
                    }
                });
            });
        } catch (error) {
            console.error('添加音频按钮事件失败:', error);
        }

        targetPanel.classList.add('show');
    }

    // 创建翻译面板
    function createTranslatorPanel() {
        const panel = document.createElement('div');
        panel.className = 'translator-panel';
        panel.innerHTML = `
            <div class="title-bar">
                <div class="title-wrapper">
                    <span class="title">${TRANSLATORS[CONFIG.currentTranslator].name}</span>
                    <span class="switch-text">（点击切换）</span>
                    <svg class="switch-icon" viewBox="0 0 1024 1024">
                        <path fill="currentColor" d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
                    </svg>
                </div>
                <div class="external-button" title="在新窗口打开翻译"></div>
                <div class="pin-button unpinned" title="固定窗口"></div>
                <div class="theme-button light" title="切换深色模式"></div>
                <div class="clear-button" title="关闭所有窗口"></div>
            </div>
            <div class="dropdown-menu"></div>
            <div class="content"></div>`;

        setupPanelEvents(panel);
        return panel;
    }

    // 修改事件处理函数
    const handleSelection = utils.debounce(async (e) => {
        if (isTranslating || state.ignoreNextSelection) return;

        try {
            const selection = window.getSelection();
            if (!selection) {
                throw new Error('无法获取选中文本');
            }

            const text = selection.toString().trim();
            if (!text || !utils.isTranslatable(text)) return;

            if (e && e.target && e.target.closest('.translator-panel')) return;

            isTranslating = true;
            beforeCreatePanel();

            try {
                const panel = createTranslatorPanel();
                if (!panel) {
                    throw new Error('创建翻译面板失败');
                }

                document.body.appendChild(panel);
                state.allPanels.add(panel);
                state.activePanel = panel;

                const range = selection.getRangeAt(0);
                if (!range) {
                    throw new Error('无法获取选中文本位置');
                }

                const rect = range.getBoundingClientRect();
                const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
                const scrollY = window.pageYOffset || document.documentElement.scrollTop;

                utils.showPanel(rect.left + scrollX, rect.bottom + scrollY, panel);
                state.currentText = text;
                await translate(text, panel);
            } catch (error) {
                console.error('处理选中文本时出错:', error);
                if (state.activePanel) {
                    utils.setError(error.message || '翻译失败，请稍后重试', state.activePanel);
                }
            }
        } catch (error) {
            console.error('选中文本处理失败:', error);
        } finally {
            isTranslating = false;
        }
    }, CONFIG.triggerDelay);

    // 事件处理器
    const eventHandlers = {
        // 处理鼠标按下
        handleMouseDown(e) {
            // 如果正在面板内选择，不处理外部事件
            if (state.isSelectingInPanel) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            // 如果是右键点击，设置状态
            if (e.button === 2) {
                state.isRightClickPending = true;
                return;
            }

            const now = Date.now();
            // 重置点击计数器（如果距离上次点击超过200ms）
            if (now - state.lastClickTime > 300) {
                state.clickCount = 0;
            }
            state.clickCount++;
            state.lastClickTime = now;

            // 如果是三连击，阻止接下来的选择触发
            if (state.clickCount >= 3) {
                utils.preventSelectionTrigger();
            }
        },

        // 处理鼠标释放
        handleMouseUp(e) {
            // 如果正在面板内选择，不处理外部事件
            if (state.isSelectingInPanel) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            // 如果是右键点击后的左键点击，直接隐藏非固定面板
            if (state.isRightClickPending && e.button === 0) {
                document.querySelectorAll('.translator-panel:not(.pinned)').forEach(panel => {
                    utils.hidePanel(panel);
                });
                state.isRightClickPending = false;
                utils.preventSelectionTrigger();
                return;
            }

            // 重置右键状态
            if (e.button === 2) {
                state.isRightClickPending = false;
                return;
            }

            if (utils.isClickInPanel(e) || state.isDragging) {
                utils.preventSelectionTrigger();
                return;
            }

            handleSelection(e);
        },

        // 处理面板外点击
        handleOutsideClick(e) {
            // 如果正在面板内选择，不处理外部事件
            if (state.isSelectingInPanel) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }

            // 如果是右键点击后的左键点击，不处理
            if (state.isRightClickPending) {
                return;
            }

            if (state.isDragging || utils.isClickInPanel(e)) return;

            // 隐藏所有非固定的面板
            document.querySelectorAll('.translator-panel:not(.pinned)')
                .forEach(panel => {
                    panel.classList.remove('show');
                    setTimeout(() => {
                        if (!panel.classList.contains('show')) {
                            panel.style.display = 'none';
                            // 如果不是主面板且没有固定，则移除
                            if (panel !== currentPanel && !panel.classList.contains('pinned')) {
                                panel.remove();
                            }
                        }
                    }, CONFIG.animationDuration);
                });
        }
    };

    // 注册事件监听器
    document.addEventListener('mousedown', eventHandlers.handleMouseDown, true);
    document.addEventListener('mouseup', eventHandlers.handleMouseUp, true);
    document.addEventListener('click', eventHandlers.handleOutsideClick, true);

    // 添加右键菜单事件处理
    document.addEventListener('contextmenu', (e) => {
        // 如果不是在翻译面板内，设置右键状态
        if (!e.target.closest('.translator-panel')) {
            state.isRightClickPending = true;
        }
    });

    // 处理翻译器切换
    function setupTranslatorSwitch(targetPanel) {
        const titleWrapper = targetPanel.querySelector('.title-wrapper');
        const switchIcon = targetPanel.querySelector('.switch-icon');
        const dropdownMenu = targetPanel.querySelector('.dropdown-menu');
        targetPanel.isDropdownOpen = false;

        // 更新下拉菜单HTML
        function updateDropdownMenu() {
            const defaultTranslator = GM_getValue('defaultTranslator', 'google');
            dropdownMenu.innerHTML = Object.entries(TRANSLATORS)
                .map(([key, translator]) => `
                    <div class="dropdown-item${key === CONFIG.currentTranslator ? ' active' : ''}${key === defaultTranslator ? ' is-default' : ''}"
                        data-translator="${key}">
                        <span class="translator-name">
                            ${key === CONFIG.currentTranslator ? '✓ ' : ''}${translator.name}
                        </span>
                        <span class="set-default" title="设为默认翻译器">设为默认</span>
                    </div>
                `).join('');
        }

        const toggleDropdown = (show) => {
            if (show === targetPanel.isDropdownOpen) return;

            targetPanel.isDropdownOpen = show;
            switchIcon.classList.toggle('open', show);

            if (show) {
                updateDropdownMenu();
                dropdownMenu.classList.add('show');

                // 检查面板在视口中的位置
                const panelRect = targetPanel.getBoundingClientRect();
                const spaceAbove = panelRect.top;
                const spaceBelow = window.innerHeight - panelRect.bottom;
                const menuHeight = dropdownMenu.offsetHeight || 100;

                const shouldDropDown = spaceAbove < menuHeight && spaceBelow > menuHeight;
                dropdownMenu.style.cssText = shouldDropDown ? `
                    bottom: auto !important;
                    top: calc(100% + 1px) !important;
                    transform-origin: top !important;
                    border-radius: 4px !important;
                    margin: 0 !important;
                ` : `
                    top: auto !important;
                    bottom: calc(100% + 1px) !important;
                    transform-origin: bottom !important;
                    border-radius: 4px !important;
                    margin: 0 !important;
                `;
            } else {
                dropdownMenu.classList.remove('show');
                // 等待过渡动画完成后清空内容
                setTimeout(() => {
                    if (!targetPanel.isDropdownOpen) {
                        dropdownMenu.innerHTML = '';
                        dropdownMenu.removeAttribute('style');
                    }
                }, 150);
            }
        };

        // 移除旧的事件监听器
        titleWrapper.removeEventListener('click', titleWrapper.clickHandler);
        dropdownMenu.removeEventListener('click', dropdownMenu.clickHandler);

        // 移除旧的鼠标离开事件监听器
        targetPanel.removeEventListener('mouseleave', targetPanel.mouseLeaveHandler);
        titleWrapper.removeEventListener('mouseleave', titleWrapper.mouseLeaveHandler);
        dropdownMenu.removeEventListener('mouseleave', dropdownMenu.mouseLeaveHandler);

        // 添加新的事件监听器
        titleWrapper.clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown(!targetPanel.isDropdownOpen);
        };
        titleWrapper.addEventListener('click', titleWrapper.clickHandler);

        dropdownMenu.clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const item = e.target.closest('.dropdown-item');
            if (!item) return;

            const setDefaultBtn = e.target.closest('.set-default');
            const translatorKey = item.dataset.translator;

            if (setDefaultBtn) {
                // 设为默认翻译器，但不改变当前翻译器
                GM_setValue('defaultTranslator', translatorKey);
                utils.updateAllPanels(translatorKey, true);
            } else if (translatorKey !== CONFIG.currentTranslator) {
                // 切换当前翻译器并重新翻译
                utils.updateAllPanels(translatorKey, false);

                // 如果有当前文本，重新翻译
                if (state.currentText) {
                    translate(state.currentText, targetPanel);
                }
            }

            // 更新下拉菜单内容但保持打开状态
            updateDropdownMenu();
        };
        dropdownMenu.addEventListener('click', dropdownMenu.clickHandler);

        // 添加鼠标进入事件处理
        const handleMouseEnter = () => {
            clearTimeout(targetPanel.dropdownCloseTimer);
        };

        // 添加鼠标离开事件处理
        const handleMouseLeave = () => {
            targetPanel.dropdownCloseTimer = setTimeout(() => {
            if (targetPanel.isDropdownOpen) {
                toggleDropdown(false);
            }
            }, 100); // 添加小延迟，使过渡更平滑
        };

        // 为整个面板添加鼠标进入/离开事件
        targetPanel.addEventListener('mouseenter', handleMouseEnter);
        targetPanel.addEventListener('mouseleave', handleMouseLeave);

        // 保存事件处理函数引用以便后续清理
        targetPanel.mouseEnterHandler = handleMouseEnter;
        targetPanel.mouseLeaveHandler = handleMouseLeave;
    }

    // 处理固定按钮点击
    function handlePinClick(e, targetPanel) {
        e.preventDefault();
        e.stopPropagation();
        utils.preventSelectionTrigger();

        const pinButton = e.target;
        const isPinned = state.pinnedPanels.has(targetPanel);

        if (isPinned) {
            state.pinnedPanels.delete(targetPanel);
            targetPanel.classList.remove('pinned');
            pinButton.className = 'pin-button unpinned';
            pinButton.title = '固定窗口';
        } else {
            state.pinnedPanels.add(targetPanel);
            targetPanel.classList.add('pinned');
            pinButton.className = 'pin-button pinned';
            pinButton.title = '取消固定';
        }
    }

    // 设置面板事件
    function setupPanelEvents(targetPanel) {
        setupTranslatorSwitch(targetPanel);

        // 初始化固定按钮状态
        const pinButton = targetPanel.querySelector('.pin-button');
        const isPinned = state.pinnedPanels.has(targetPanel);
        pinButton.className = `pin-button ${isPinned ? 'pinned' : 'unpinned'}`;
        pinButton.title = isPinned ? '取消固定' : '固定窗口';

        utils.addEventHandler(pinButton, 'click', (e) => handlePinClick(e, targetPanel));

        // 初始化主题按钮状态和事件
        const themeButton = targetPanel.querySelector('.theme-button');
        const isDark = utils.isDarkMode();
        themeButton.className = `theme-button ${isDark ? 'dark' : 'light'}`;
        themeButton.title = isDark ? '切换亮色模式' : '切换深色模式';
        targetPanel.classList.toggle(CONFIG.darkModeClass, isDark);

        utils.addEventHandler(themeButton, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            utils.toggleDarkMode();
            // 更新主题按钮的提示文本
            document.querySelectorAll('.translator-panel .theme-button').forEach(btn => {
                btn.title = btn.classList.contains('dark') ? '切换亮色模式' : '切换深色模式';
            });
        });

        // 初始化清除按钮事件
        const clearButton = targetPanel.querySelector('.clear-button');
        utils.addEventHandler(clearButton, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            utils.preventSelectionTrigger();

            // 重置选择状态
            state.isSelectingInPanel = false;
            state.selectingPanel = null;
            document.body.style.userSelect = '';

            // 关闭所有翻译窗口，包括固定的和当前窗口
            const panels = Array.from(document.querySelectorAll('.translator-panel'));
            panels.forEach(panel => {
                // 先从固定面板集合中移除
                state.pinnedPanels.delete(panel);
                // 移除固定状态的类名
                panel.classList.remove('pinned');
                // 移除显示状态的类名
                panel.classList.remove('show');
                // 移除事件监听器
                utils.removeAllEventHandlers(panel);
                // 从状态管理中移除
                state.allPanels.delete(panel);
                // 从DOM中移除
                panel.remove();
            });

            // 重置所有状态
            state.activePanel = null;
            state.currentText = '';
            state.isSelectingInPanel = false;
            state.selectingPanel = null;
            state.isDragging = false;
            state.dragTarget = null;
            state.lastClickTime = 0;
            state.clickCount = 0;
            state.ignoreNextSelection = false;
            state.isRightClickPending = false;

            // 重新创建主面板（但保持隐藏状态）
            const newPanel = createTranslatorPanel();
            document.body.appendChild(newPanel);
            state.allPanels.add(newPanel);
            currentPanel = newPanel;
        });

        // 添加面板内选择事件处理
        utils.addEventHandler(targetPanel, 'mousedown', (e) => {
            if (e.target.closest('.audio-button')) return;

            if (e.target.closest('.content')) {
                const selection = window.getSelection();
                const now = Date.now();

                if (now - state.lastClickTime < 300) {
                    state.clickCount++;
                    if (state.clickCount >= 3) {
                        state.lastClickTime = now;
                        return;
                    }
                } else {
                    state.clickCount = 1;
                }
                state.lastClickTime = now;

                // 开始选择
                state.isSelectingInPanel = true;
                state.selectingPanel = targetPanel;
                document.body.style.userSelect = 'none';

                e.stopPropagation();
            }
        });

        // 添加右键菜单事件处理
        utils.addEventHandler(targetPanel, 'contextmenu', (e) => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && e.target.closest('.content')) {
                e.stopPropagation();
                return;
            }
            // 如果没有选中文本，关闭所有未固定的面板
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.translator-panel:not(.pinned)').forEach(panel => {
                utils.hidePanel(panel);
            });
        });

        utils.addEventHandler(targetPanel, 'mousemove', (e) => {
            if (state.isSelectingInPanel) {
                e.stopPropagation();
            }
        });

        utils.addEventHandler(targetPanel, 'mouseup', (e) => {
            if (state.isSelectingInPanel) {
                state.isSelectingInPanel = false;
                state.selectingPanel = null;
                document.body.style.userSelect = '';
                e.stopPropagation();
                utils.preventSelectionTrigger();
            }
        });

        // 添加全局鼠标抬起事件处理
        const handleGlobalMouseUp = (e) => {
            if (state.isSelectingInPanel) {
                state.isSelectingInPanel = false;
                state.selectingPanel = null;
                document.body.style.userSelect = '';
                e.stopPropagation();
                e.preventDefault();
                utils.preventSelectionTrigger();
            }
        };

        utils.addEventHandler(document, 'mouseup', handleGlobalMouseUp, { capture: true });

        // 标题栏拖动功能
        const titleBar = targetPanel.querySelector('.title-bar');
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        const handleDragStart = (e) => {
            if (!e.target.closest('.title-bar')) return;

            state.isDragging = true;
            state.dragTarget = targetPanel;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(targetPanel.style.left);
            startTop = parseInt(targetPanel.style.top);

            utils.addEventHandler(document, 'mousemove', handleDragMove);
            utils.addEventHandler(document, 'mouseup', handleDragEnd);

            e.preventDefault();
            e.stopPropagation();
        };

        const handleDragMove = (e) => {
            if (!state.isDragging || state.dragTarget !== targetPanel) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const newX = Math.max(
                CONFIG.panelSpacing,
                Math.min(viewportWidth - targetPanel.offsetWidth - CONFIG.panelSpacing,
                        startLeft + dx)
            );
            const newY = Math.max(
                CONFIG.panelSpacing,
                Math.min(viewportHeight - targetPanel.offsetHeight - CONFIG.panelSpacing,
                        startTop + dy)
            );

            targetPanel.style.left = `${newX}px`;
            targetPanel.style.top = `${newY}px`;

            e.preventDefault();
            e.stopPropagation();
        };

        const handleDragEnd = (e) => {
            if (!state.isDragging || state.dragTarget !== targetPanel) return;

            state.isDragging = false;
            state.dragTarget = null;

            utils.removeEventHandler(document, 'mousemove');
            utils.removeEventHandler(document, 'mouseup');

            // 只有在位置真的变化时才自动固定面板
            if (startLeft !== parseInt(targetPanel.style.left) || startTop !== parseInt(targetPanel.style.top)) {
                if (!state.pinnedPanels.has(targetPanel)) {
                    const pinButton = targetPanel.querySelector('.pin-button');
                    pinButton.className = 'pin-button pinned';
                    pinButton.title = '取消固定';
                    targetPanel.classList.add('pinned');
                    state.pinnedPanels.add(targetPanel);
                }
            }

            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        utils.addEventHandler(targetPanel, 'mousedown', handleDragStart);

        // 初始化外部链接按钮事件
        const externalButton = targetPanel.querySelector('.external-button');
        utils.addEventHandler(externalButton, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            utils.preventSelectionTrigger();

            const text = state.currentText;
            if (!text) return;

            let url;
            switch (CONFIG.currentTranslator) {
                case 'google':
                    url = `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(text)}`;
                    break;
                case 'youdao':
                    url = `https://dict.youdao.com/w/${encodeURIComponent(text)}`;
                    break;
                case 'cambridge':
                    url = `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(text)}`;
                    break;
            }

            if (url) {
                window.open(url, '_blank');
            }
        });
    }

    // 创建主翻译面板
    const panel = document.createElement('div');
    panel.className = 'translator-panel';
    panel.innerHTML = `
        <div class="title-bar">
            <div class="title-wrapper">
                <span class="title">${TRANSLATORS[CONFIG.currentTranslator].name}</span>
                <span class="switch-text">（点击切换）</span>
                <svg class="switch-icon" viewBox="0 0 1024 1024">
                    <path fill="currentColor" d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
                </svg>
            </div>
            <div class="external-button" title="在新窗口打开翻译"></div>
            <div class="pin-button unpinned" title="固定窗口"></div>
            <div class="theme-button light" title="切换深色模式"></div>
            <div class="clear-button" title="关闭所有窗口"></div>
        </div>
        <div class="dropdown-menu"></div>
        <div class="content"></div>`;
    document.body.appendChild(panel);
    state.allPanels.add(panel);

    // 初始化面板事件
    setupPanelEvents(panel);
})();

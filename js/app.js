// === 應用配置 ===
const CONFIG = {
    DATA_PATH: 'data/',
    UNITS_INDEX: 'units-index.json',
    DEFAULT_UNIT: 'unit1',
    AUDIO_PATH: 'data/audio/',      // 本地MP3存放路徑
    ENABLE_LOCAL_AUDIO: true,       // 是否嘗試本地音頻
    ENABLE_TTS_FALLBACK: true       // 是否啟用TTS備援
};

// === 全局變量 ===
let appData = null;
let unitsIndex = [];
let currentUnitId = '';
let starData = {};
let learningStats = {};
let defaultStars = {};

// ----- 新增：拖拽管理器實例 -----
let dragManager = null;
let vocabDragManager = null;

// === 精確學習計時器（優化） ===
class LearningTimer {
    constructor() {
        this.startTime = null;
        this.accumulatedTime = 0;    // 分鐘
        this.isActive = false;
        this.visibilityHandler = this.handleVisibilityChange.bind(this);
        this.beforeUnloadHandler = this.saveTime.bind(this);
    }

    start() {
        if (!this.isActive) {
            this.startTime = Date.now();
            this.isActive = true;
            document.addEventListener('visibilitychange', this.visibilityHandler);
            window.addEventListener('beforeunload', this.beforeUnloadHandler);
        }
    }

    pause() {
        if (this.isActive && this.startTime) {
            this.accumulatedTime += (Date.now() - this.startTime) / 60000;
            this.startTime = null;
            this.isActive = false;
        }
    }

    resume() {
        if (!this.isActive && document.visibilityState === 'visible') {
            this.startTime = Date.now();
            this.isActive = true;
        }
    }

    handleVisibilityChange() {
        if (document.hidden) {
            this.pause();
        } else {
            this.resume();
        }
    }

    saveTime() {
        this.pause();
        if (learningStats[currentUnitId] && this.accumulatedTime > 0) {
            learningStats[currentUnitId].totalTime = (learningStats[currentUnitId].totalTime || 0) + this.accumulatedTime;
            saveLearningStats();
            this.accumulatedTime = 0;
        }
    }

    reset() {
        this.saveTime();
        this.accumulatedTime = 0;
        this.startTime = null;
        this.isActive = false;
    }
}
const learningTimer = new LearningTimer();

// === 改良音頻播放器（備援：本地MP3 → TTS → 文字提示） ===
class StableAudioPlayer {
    constructor() {
        this.currentAudioBtn = null;
        this.currentUtterance = null;
        this.isPlaying = false;
        this.currentAudioElement = null;
        this.warmUpTTS();
    }

    warmUpTTS() { /* 保持原有預熱 */ }

    // 核心播放方法，支援備援
    async playAudio(audioKey, btn, event) {
        stopPropagation(event);
        if (this.isPlaying && this.currentAudioBtn === btn) {
            this.stopCurrentAudio();
            return;
        }
        if (this.isPlaying) this.stopCurrentAudio();

        const text = this.getTextForAudioKey(audioKey);
        const cardElement = btn.closest('.card-front, .card-back')?.closest('.flashcard');

        // 設置加載狀態
        btn.classList.add('loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            // 策略1: 嘗試播放本地MP3（若啟用）
            if (CONFIG.ENABLE_LOCAL_AUDIO) {
                const localPlayed = await this.tryPlayLocalAudio(audioKey, btn);
                if (localPlayed) {
                    this.showAudioStatus(cardElement, '🔊 本地音頻');
                    return;
                }
            }

            // 策略2: TTS備援
            if (CONFIG.ENABLE_TTS_FALLBACK) {
                await this.playBrowserTTS(text, btn);
                this.showAudioStatus(cardElement, '🗣️ 瀏覽器語音');
                return;
            }

            // 策略3: 文字提示（極端情況）
            this.showAudioStatus(cardElement, '⚠️ 無法播放音頻', 3000);
            throw new Error('所有音頻備援均失敗');
        } catch (error) {
            console.error('音頻播放失敗:', error);
            this.showAudioStatus(cardElement, '❌ 播放失敗', 2000);
        } finally {
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
            btn.disabled = false;
        }
    }

    // 嘗試播放本地MP3
    tryPlayLocalAudio(audioKey, btn) {
        return new Promise((resolve) => {
            // 根據audioKey構建URL，支援 .mp3 或 .m4a
            const possiblePaths = [
                `${CONFIG.AUDIO_PATH}${currentUnitId}/${audioKey}.mp3`,
                `${CONFIG.AUDIO_PATH}${currentUnitId}/${audioKey}.m4a`,
                `${CONFIG.AUDIO_PATH}${audioKey}.mp3`
            ];

            let attempted = 0;
            const tryNext = () => {
                if (attempted >= possiblePaths.length) {
                    resolve(false);
                    return;
                }
                const audio = new Audio();
                audio.src = possiblePaths[attempted];
                audio.preload = 'metadata';

                const timeout = setTimeout(() => {
                    attempted++;
                    tryNext();
                }, 1000); // 1秒超時

                audio.oncanplaythrough = () => {
                    clearTimeout(timeout);
                    audio.play()
                        .then(() => {
                            this.currentAudioElement = audio;
                            this.currentAudioBtn = btn;
                            this.isPlaying = true;
                            btn.classList.add('playing');
                            btn.innerHTML = '<i class="fas fa-stop"></i>';

                            audio.onended = () => {
                                this.stopCurrentAudio();
                                resolve(true);
                            };
                            resolve(true);
                        })
                        .catch(() => {
                            attempted++;
                            tryNext();
                        });
                };
                audio.onerror = () => {
                    attempted++;
                    tryNext();
                };
            };
            tryNext();
        });
    }

    // TTS播放（改良：錯誤時 reject）
    playBrowserTTS(text, btn) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                reject('TTS不支持');
                return;
            }
            if (speechSynthesis.speaking) speechSynthesis.cancel();
            this.currentUtterance = new SpeechSynthesisUtterance(text);
            this.currentUtterance.lang = 'en-GB';
            this.currentUtterance.rate = 0.85;
            this.currentUtterance.volume = 1.0;
            this.currentUtterance.onstart = () => {
                this.isPlaying = true;
                this.currentAudioBtn = btn;
                btn.classList.add('playing');
                btn.innerHTML = '<i class="fas fa-stop"></i>';
                resolve();
            };
            this.currentUtterance.onerror = reject;
            this.currentUtterance.onend = () => {
                this.stopCurrentAudio();
                resolve();
            };
            speechSynthesis.speak(this.currentUtterance);
        });
    }

    stopCurrentAudio() {
        this.isPlaying = false;
        if (this.currentAudioElement) {
            this.currentAudioElement.pause();
            this.currentAudioElement = null;
        }
        if (speechSynthesis) speechSynthesis.cancel();
        if (this.currentAudioBtn) {
            this.currentAudioBtn.classList.remove('playing', 'loading');
            this.currentAudioBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            this.currentAudioBtn.disabled = false;
            this.currentAudioBtn = null;
        }
        this.currentUtterance = null;
    }

    getTextForAudioKey(audioKey) { /* 保持不變 */ }
    showAudioStatus(cardElement, message, duration = 2000) { /* 保持不變 */ }
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}
const audioPlayer = new StableAudioPlayer();

// ============= 新增：通用拖拽管理器 =============
class DragDropManager {
    constructor(options = {}) {
        this.dropZones = [];          // 存放拖放區選擇器
        this.dragItems = [];          // 存放可拖拽元素選擇器
        this.history = [];
        this.maxHistory = 20;
        this.onDropCallback = options.onDrop || null;
        this.onUndoCallback = options.onUndo || null;
        this.dropzoneClass = options.dropzoneClass || '.dropzone';
        this.dragItemClass = options.dragItemClass || '.drag-item';
        this.usedClass = 'used';
        this.filledClass = 'filled';
    }

    init() {
        document.addEventListener('dragstart', this.handleDragStart.bind(this));
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', this.handleDrop.bind(this));
    }

    handleDragStart(e) {
        if (e.target.classList.contains(this.dragItemClass.slice(1))) {
            if (e.target.classList.contains(this.usedClass)) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.setData('text/plain', e.target.id);
            e.target.classList.add('dragging');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        const dropzone = e.target.closest(this.dropzoneClass);
        if (!dropzone) return;

        const data = e.dataTransfer.getData('text/plain');
        const draggedEl = document.getElementById(data);
        if (!draggedEl || draggedEl.classList.contains(this.usedClass)) return;

        // 記錄歷史
        this.history.push({
            dropzone: dropzone,
            previousHTML: dropzone.innerHTML,
            previousData: dropzone.getAttribute('data-answer'),
            optionId: data,
            draggedElement: draggedEl
        });
        if (this.history.length > this.maxHistory) this.history.shift();

        // 填充內容
        dropzone.innerHTML = draggedEl.textContent.trim();
        dropzone.classList.add(this.filledClass);
        dropzone.setAttribute('data-answer', data.replace(/^option-/, ''));

        // 標記為已使用
        draggedEl.classList.add(this.usedClass);
        draggedEl.draggable = false;

        // 回調
        if (this.onDropCallback) this.onDropCallback(dropzone, draggedEl);
    }

    undo() {
        if (this.history.length === 0) return;
        const last = this.history.pop();
        last.dropzone.innerHTML = last.previousHTML;
        last.dropzone.classList.remove(this.filledClass, 'correct', 'incorrect');
        last.dropzone.removeAttribute('data-answer');
        if (last.draggedElement) {
            last.draggedElement.classList.remove(this.usedClass);
            last.draggedElement.draggable = true;
        }
        if (this.onUndoCallback) this.onUndoCallback(last);
    }

    reset() {
        this.history = [];
        // 重置所有拖放區
        document.querySelectorAll(this.dropzoneClass).forEach(el => {
            el.innerHTML = '';
            el.classList.remove(this.filledClass, 'correct', 'incorrect');
            el.removeAttribute('data-answer');
        });
        // 重置所有可拖拽項
        document.querySelectorAll(this.dragItemClass).forEach(el => {
            el.classList.remove(this.usedClass);
            el.draggable = true;
        });
    }
}

// ============= 新增：輸入框寬度自適應 =============
function initAdaptiveInputs(containerSelector = '.cloze-input, .grammar-input') {
    document.querySelectorAll(containerSelector).forEach(input => {
        // 避免重複綁定
        if (input.dataset.adaptiveInit) return;
        input.dataset.adaptiveInit = 'true';
        input.addEventListener('input', function() {
            const charCount = this.value.length;
            // 最小寬度 1.8em（cloze）或 1.5em（grammar）
            const minWidth = this.classList.contains('cloze-input') ? 1.8 : 1.5;
            const width = Math.max(minWidth, charCount * 0.7 + 0.8);
            this.style.width = `${width}em`;
        });
        // 初始化寬度
        input.dispatchEvent(new Event('input'));
    });
}

// ============= 新增：圖片錯誤處理 =============
function initImageFallback() {
    document.querySelectorAll('img[data-fallback]').forEach(img => {
        img.addEventListener('error', function() {
            this.style.display = 'none';
            const fallback = document.getElementById(this.dataset.fallback);
            if (fallback) fallback.style.display = 'flex';
        });
    });
}

// ============= 練習題渲染函數（動態） =============
function renderExercises() {
    if (!appData) return;

    // 詞彙運用拖拽
    if (appData.exercises?.vocabDrag) {
        document.getElementById('vocab-drag-section').style.display = 'block';
        renderVocabDrag(appData.exercises.vocabDrag);
    } else {
        document.getElementById('vocab-drag-section').style.display = 'none';
    }

    // 完形填空
    if (appData.exercises?.cloze) {
        document.getElementById('cloze-section').style.display = 'block';
        document.getElementById('cloze-text').innerHTML = appData.exercises.cloze.text;
        initAdaptiveInputs('#cloze-text .cloze-input');
    } else {
        document.getElementById('cloze-section').style.display = 'none';
    }

    // 句子配對 7選5
    if (appData.exercises?.sevenFive) {
        document.getElementById('sevenfive-section').style.display = 'block';
        renderSevenFive(appData.exercises.sevenFive);
    } else {
        document.getElementById('sevenfive-section').style.display = 'none';
    }

    // 語法填空
    if (appData.exercises?.grammar) {
        document.getElementById('grammar-section').style.display = 'block';
        document.getElementById('grammar-text').innerHTML = appData.exercises.grammar.text;
        initAdaptiveInputs('#grammar-text .grammar-input');
    } else {
        document.getElementById('grammar-section').style.display = 'none';
    }
}

// ----- 詞彙拖拽渲染 -----
function renderVocabDrag(data) {
    const container = document.getElementById('vocab-drag-container');
    // 生成可拖拽選項
    let optionsHtml = '<div class="drag-source-panel"><span class="drag-label">拖拽詞彙到空白處：</span>';
    data.options.forEach((opt, idx) => {
        optionsHtml += `<span class="drag-item" id="vd-${idx}" draggable="true">${opt}</span>`;
    });
    optionsHtml += '</div>';

    // 生成填空句子
    let sentencesHtml = '<div class="drag-sentences">';
    data.sentences.forEach((s, idx) => {
        sentencesHtml += `<div class="drag-sentence">${idx+1}. ${s.replace(/{{gap}}/, `<span class="dropzone" id="vd-drop-${idx}"></span>`)}</div>`;
    });
    sentencesHtml += '</div>';

    container.innerHTML = optionsHtml + sentencesHtml;

    // 初始化拖拽管理器
    vocabDragManager = new DragDropManager({
        dropzoneClass: '.dropzone',
        dragItemClass: '.drag-item',
        onDrop: (dropzone, dragged) => {
            // 自動調整寬度
            const content = dropzone.textContent.trim();
            dropzone.style.minWidth = `${Math.max(80, content.length * 12)}px`;
        }
    });
    vocabDragManager.init();
}

// ----- 句子配對渲染 -----
function renderSevenFive(data) {
    const container = document.getElementById('sevenfive-drag-container');
    let optionsHtml = '<div class="drag-source-panel"><span class="drag-label">拖拽短語到正確位置：</span>';
    data.options.forEach((opt, idx) => {
        optionsHtml += `<span class="drag-item" id="sf-${idx}" draggable="true">${opt.text}</span>`;
    });
    optionsHtml += '</div>';
    container.innerHTML = optionsHtml;

    // 渲染文章內容
    document.getElementById('sevenfive-text').innerHTML = data.text;

    // 初始化拖拽管理器（全域）
    if (!dragManager) {
        dragManager = new DragDropManager({
            dropzoneClass: '.seven-five-dropzone',
            dragItemClass: '.drag-item'
        });
        dragManager.init();
    }
}

// ----- 檢查答案函數（簡化示例）-----
function checkVocabDrag() {
    const answers = appData.exercises.vocabDrag.answers;
    let correct = 0;
    answers.forEach((ans, idx) => {
        const drop = document.getElementById(`vd-drop-${idx}`);
        const userAns = drop?.getAttribute('data-answer');
        const correctAns = ans.toLowerCase();
        drop.classList.remove('correct', 'incorrect');
        if (userAns && userAns.toLowerCase() === correctAns) {
            drop.classList.add('correct');
            correct++;
        } else {
            drop.classList.add('incorrect');
            // 顯示正確答案
            drop.innerHTML = `<span style="color:#b91c1c;">✗</span> ${correctAns}`;
        }
    });
    showFeedback('vocab-drag-feedback', correct, answers.length);
}

function undoVocabDrag() { vocabDragManager?.undo(); }
function resetVocabDrag() { vocabDragManager?.reset(); renderVocabDrag(appData.exercises.vocabDrag); }

function checkCloze() { /* 遍歷輸入框比對答案，略 */ }
function resetCloze() { /* 重置所有輸入框，略 */ }

function checkSevenFive() { /* 拖拽答案檢查，略 */ }
function undoSevenFiveDrag() { dragManager?.undo(); }
function resetSevenFive() { dragManager?.reset(); renderSevenFive(appData.exercises.sevenFive); }

function checkGrammar() { /* 略 */ }
function resetGrammar() { /* 略 */ }

function showFeedback(containerId, correct, total) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const percentage = Math.round((correct/total)*100);
    if (correct === total) {
        el.innerHTML = `<span class="feedback-correct">🎉 全部正確！ (${correct}/${total})</span>`;
    } else {
        el.innerHTML = `<span class="feedback-incorrect">📊 答對 ${correct} 題，答錯 ${total-correct} 題 (${percentage}%)</span>`;
    }
    el.style.display = 'block';
}

// === 原有函數保留，但需要擴展 ===
// loadUnitsIndex, loadUnitData, initStarData, initLearningStats, saveLearningStats, 等保持不變
// 關鍵修改：在 loadUnit 成功後調用 renderExercises()，並啟動計時器

async function loadUnit(unitId) {
    if (!unitId || unitId === currentUnitId) return;
    currentUnitId = unitId;
    // ... 原有加載邏輯
    const success = await loadUnitData(unitId);
    if (success) {
        initStarData();
        initLearningStats();
        generateCards();
        renderExercises();      // <-- 新增：渲染練習題
        learningTimer.start();  // <-- 啟動精確計時
        // ...
    }
}

// === 原有卡片生成、星星系統等保持不變 ===

// === 初始化頁面（擴展） ===
async function initPage() {
    await loadUnitsIndex();
    // ... 原有邏輯
    initImageFallback();        // 圖片錯誤處理
    // 監聽單元切換時重置計時器
    document.getElementById('unit-select').addEventListener('change', function() {
        learningTimer.saveTime(); // 保存當前單元時間
        loadUnit(this.value);
    });
    // 頁面卸載時保存時間
    window.addEventListener('beforeunload', () => learningTimer.saveTime());
}
window.addEventListener('load', initPage);
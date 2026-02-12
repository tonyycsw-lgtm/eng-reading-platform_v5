// === 應用配置 ===
const CONFIG = {
    DATA_PATH: 'data/',
    UNITS_INDEX: 'units-index.json',
    DEFAULT_UNIT: 'unit1',
    AUDIO_PATH: 'data/audio/',
    ENABLE_LOCAL_AUDIO: true,
    ENABLE_TTS_FALLBACK: true
};

// === 全局變量 ===
let appData = null;
let unitsIndex = [];
let currentUnitId = '';
let starData = {};
let learningStats = {};
let defaultStars = {};

// ----- 拖拽管理器實例 -----
let dragManager = null;
let vocabDragManager = null;

// === 輔助函數 ===
function stopPropagation(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
}

function formatDate(dateString) {
    if (!dateString) return '從未';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-HK');
}

function formatTime(minutes) {
    if (minutes < 60) {
        return `${minutes} 分鐘`;
    } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours} 小時 ${mins} 分鐘` : `${hours} 小時`;
    }
}

// === 精確學習計時器 ===
class LearningTimer {
    constructor() {
        this.startTime = null;
        this.accumulatedTime = 0;
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

// === 改良音頻播放器 ===
class StableAudioPlayer {
    constructor() {
        this.currentAudioBtn = null;
        this.currentUtterance = null;
        this.isPlaying = false;
        this.currentAudioElement = null;
        this.warmUpTTS();
    }
    
    warmUpTTS() {
        if ('speechSynthesis' in window) {
            try {
                const utterance = new SpeechSynthesisUtterance('');
                utterance.volume = 0;
                speechSynthesis.speak(utterance);
                setTimeout(() => speechSynthesis.cancel(), 100);
            } catch (e) {}
        }
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
    
    showAudioStatus(cardElement, message, duration = 2000) {
        let statusElement = cardElement?.querySelector('.audio-status');
        if (!statusElement && cardElement) {
            statusElement = document.createElement('div');
            statusElement.className = 'audio-status';
            cardElement.appendChild(statusElement);
        }
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.classList.add('show');
            setTimeout(() => statusElement.classList.remove('show'), duration);
        }
    }
    
    async playAudio(audioKey, btn, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (this.isPlaying && this.currentAudioBtn === btn) {
            this.stopCurrentAudio();
            return;
        }
        if (this.isPlaying) this.stopCurrentAudio();

        const text = this.getTextForAudioKey(audioKey);
        const cardElement = btn.closest('.card-front, .card-back')?.closest('.flashcard');

        btn.classList.add('loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            if (CONFIG.ENABLE_LOCAL_AUDIO) {
                const localPlayed = await this.tryPlayLocalAudio(audioKey, btn);
                if (localPlayed) {
                    this.showAudioStatus(cardElement, '🔊 本地音頻');
                    return;
                }
            }

            if (CONFIG.ENABLE_TTS_FALLBACK) {
                await this.playBrowserTTS(text, btn);
                this.showAudioStatus(cardElement, '🗣️ 瀏覽器語音');
                return;
            }

            this.showAudioStatus(cardElement, '⚠️ 無法播放音頻', 3000);
        } catch (error) {
            console.error('音頻播放失敗:', error);
            this.showAudioStatus(cardElement, '❌ 播放失敗', 2000);
        } finally {
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
            btn.disabled = false;
        }
    }
    
    tryPlayLocalAudio(audioKey, btn) {
        return new Promise((resolve) => {
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
                }, 1000);

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
    
    getTextForAudioKey(audioKey) {
        if (!appData) return audioKey;
        const word = appData.words?.find(w => w.audio === audioKey);
        if (word) return word.english;
        const sentence = appData.sentences?.find(s => s.audio === audioKey);
        if (sentence) return sentence.english;
        return audioKey;
    }
    
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}
const audioPlayer = new StableAudioPlayer();

// === 拖拽管理器 ===
class DragDropManager {
    constructor(options = {}) {
        this.history = [];
        this.maxHistory = 20;
        this.onDropCallback = options.onDrop || null;
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

        this.history.push({
            dropzone: dropzone,
            previousHTML: dropzone.innerHTML,
            previousData: dropzone.getAttribute('data-answer'),
            optionId: data,
            draggedElement: draggedEl
        });
        if (this.history.length > this.maxHistory) this.history.shift();

        dropzone.innerHTML = draggedEl.textContent.trim();
        dropzone.classList.add(this.filledClass);
        dropzone.setAttribute('data-answer', data.replace(/^vd-|^sf-/, ''));

        draggedEl.classList.add(this.usedClass);
        draggedEl.draggable = false;

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
    }

    reset() {
        this.history = [];
        document.querySelectorAll(this.dropzoneClass).forEach(el => {
            el.innerHTML = '';
            el.classList.remove(this.filledClass, 'correct', 'incorrect');
            el.removeAttribute('data-answer');
        });
        document.querySelectorAll(this.dragItemClass).forEach(el => {
            el.classList.remove(this.usedClass);
            el.draggable = true;
        });
    }
}

// === 輸入框寬度自適應 ===
function initAdaptiveInputs(containerSelector = '.cloze-input, .grammar-input') {
    document.querySelectorAll(containerSelector).forEach(input => {
        if (input.dataset.adaptiveInit) return;
        input.dataset.adaptiveInit = 'true';
        input.addEventListener('input', function() {
            const charCount = this.value.length;
            const minWidth = this.classList.contains('cloze-input') ? 1.8 : 1.5;
            const width = Math.max(minWidth, charCount * 0.7 + 0.8);
            this.style.width = `${width}em`;
        });
        input.dispatchEvent(new Event('input'));
    });
}

// === 圖片錯誤處理 ===
function initImageFallback() {
    document.querySelectorAll('img[data-fallback]').forEach(img => {
        img.addEventListener('error', function() {
            this.style.display = 'none';
            const fallback = document.getElementById(this.dataset.fallback);
            if (fallback) fallback.style.display = 'flex';
        });
    });
}

// ============= ★★★ 原有核心函數（你完全缺失的部分）★★★ =============

// === 加載單元索引 ===
async function loadUnitsIndex() {
    try {
        const response = await fetch(CONFIG.DATA_PATH + CONFIG.UNITS_INDEX);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        unitsIndex = await response.json();
        console.log('單元索引加載成功:', unitsIndex);
        return true;
    } catch (error) {
        console.error('加載單元索引失敗:', error);
        unitsIndex = { units: [] };
        return false;
    }
}

// === 加載單元數據 ===
async function loadUnitData(unitId) {
    try {
        const response = await fetch(`${CONFIG.DATA_PATH}${unitId}.json`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        appData = await response.json();
        console.log(`單元 ${unitId} 加載成功:`, appData);
        return true;
    } catch (error) {
        console.error(`加載單元 ${unitId} 失敗:`, error);
        return false;
    }
}

// === 初始化星星數據 ===
function initStarData() {
    if (!appData) return;
    const savedStarData = JSON.parse(localStorage.getItem('starData') || '{}');
    const allIds = [];
    appData.words?.forEach(word => allIds.push(word.id));
    appData.sentences?.forEach(sentence => allIds.push(sentence.id));
    
    allIds.forEach(id => {
        defaultStars[id] = 0;
        starData[id] = savedStarData[id] || 0;
    });
}

// === 初始化學習統計 ===
function initLearningStats() {
    const savedStats = JSON.parse(localStorage.getItem('learningStats') || '{}');
    learningStats = savedStats;
    
    if (!learningStats[currentUnitId]) {
        learningStats[currentUnitId] = {
            totalTime: 0,
            lastAccessed: new Date().toISOString(),
            sessions: 0,
            mastery: 0
        };
    }
}

// === 保存星星數據 ===
function saveStarData() {
    localStorage.setItem('starData', JSON.stringify(starData));
    updateDataStatus();
}

// === 保存學習統計 ===
function saveLearningStats() {
    localStorage.setItem('learningStats', JSON.stringify(learningStats));
    updateDataStatus();
}

// === 更新數據狀態指示器 ===
function updateDataStatus() {
    const status = document.getElementById('data-status');
    if (status) {
        status.classList.add('saving');
        setTimeout(() => status.classList.remove('saving'), 500);
    }
}

// === 更新學習統計 ===
function updateLearningStats() {
    if (!learningStats[currentUnitId]) {
        learningStats[currentUnitId] = {
            totalTime: 0,
            lastAccessed: new Date().toISOString(),
            sessions: 0,
            mastery: 0
        };
    }
    learningStats[currentUnitId].lastAccessed = new Date().toISOString();
    learningStats[currentUnitId].sessions = (learningStats[currentUnitId].sessions || 0) + 1;
    saveLearningStats();
}

// === 生成單詞卡片 ===
function generateWordCard(word, index) {
    const number = `單詞 ${index + 1}`;
    return `
        <div class="card-container">
            <div class="flashcard" onclick="flipCard(this)">
                <div class="card-front">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="stars-container" id="${word.id}-stars"></div>
                        <div class="stars-label" id="${word.id}-label">點擊翻轉卡片</div>
                    </div>
                    <div class="audio-buttons">
                        <button class="audio-btn" onclick="audioPlayer.playAudio('${word.audio}', this, event)">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                </div>
                <div class="card-back">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="answer-text">${word.english}</div>
                        <div class="translation-text">${word.translation}</div>
                        ${word.hint ? `<div class="hint-text">${word.hint}</div>` : ''}
                    </div>
                    <div class="action-buttons">
                        <button class="action-btn correct-btn" onclick="markCorrect('${word.id}', event)" disabled>
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="action-btn review-btn" onclick="markReview('${word.id}', event)" disabled>
                            <i class="fas fa-book"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// === 生成句子卡片 ===
function generateSentenceCard(sentence, index) {
    const number = `句子 ${index + 1}`;
    return `
        <div class="card-container sentence-card">
            <div class="flashcard" onclick="flipCard(this)">
                <div class="card-front">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="stars-container" id="${sentence.id}-stars"></div>
                        <div class="stars-label" id="${sentence.id}-label">點擊翻轉卡片</div>
                    </div>
                    <div class="audio-buttons">
                        <button class="audio-btn" onclick="audioPlayer.playAudio('${sentence.audio}', this, event)">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                </div>
                <div class="card-back">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="answer-text">${sentence.english}</div>
                        <div class="translation-text">${sentence.translation}</div>
                    </div>
                    <div class="action-buttons">
                        <button class="action-btn correct-btn" onclick="markCorrect('${sentence.id}', event)" disabled>
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="action-btn review-btn" onclick="markReview('${sentence.id}', event)" disabled>
                            <i class="fas fa-book"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// === 生成所有卡片 ===
function generateCards() {
    if (!appData) return;
    
    const wordsGrid = document.getElementById('words-grid');
    if (wordsGrid && appData.words?.length > 0) {
        wordsGrid.innerHTML = appData.words.map((word, index) => generateWordCard(word, index)).join('');
    }
    
    const sentencesGrid = document.getElementById('sentences-grid');
    if (sentencesGrid && appData.sentences?.length > 0) {
        sentencesGrid.innerHTML = appData.sentences.map((sentence, index) => generateSentenceCard(sentence, index)).join('');
    }
    
    updateStats();
}

// === 翻轉卡片 ===
function flipCard(card) {
    card.classList.toggle('flipped');
    const cardId = getCardId(card);
    if (card.classList.contains('flipped')) {
        updateButtonsState(cardId);
    } else {
        disableButtons(cardId);
    }
}

function getCardId(cardElement) {
    const starsContainer = cardElement.querySelector('.stars-container');
    return starsContainer?.id?.replace('-stars', '') || null;
}

function updateButtonsState(cardId) {
    if (!cardId) return;
    const stars = starData[cardId] || 0;
    const card = document.querySelector(`#${cardId}-stars`)?.closest('.flashcard');
    if (!card) return;
    
    const correctBtn = card.querySelector('.correct-btn');
    const reviewBtn = card.querySelector('.review-btn');
    if (correctBtn) correctBtn.disabled = (stars >= 5);
    if (reviewBtn) reviewBtn.disabled = (stars <= 0);
}

function disableButtons(cardId) {
    if (!cardId) return;
    const card = document.querySelector(`#${cardId}-stars`)?.closest('.flashcard');
    if (card) {
        card.querySelectorAll('.action-btn').forEach(btn => btn.disabled = true);
    }
}

// === 創建星星 ===
function createStars(cardId, count) {
    const container = document.getElementById(cardId + '-stars');
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const star = document.createElement('div');
        star.className = 'star' + (i < count ? ' active' : '');
        star.innerHTML = '★';
        container.appendChild(star);
    }
    
    const label = document.getElementById(cardId + '-label');
    if (label) {
        if (count === 0) label.textContent = '開始練習';
        else if (count < 3) label.textContent = '繼續加油呀!';
        else if (count < 5) label.textContent = '信心大增!';
        else label.textContent = '真棒! 你已經掌握了';
    }
}

// === 標記正確 ===
function markCorrect(cardId, event) {
    stopPropagation(event);
    if (starData[cardId] < 5) {
        starData[cardId]++;
        saveStarData();
        createStars(cardId, starData[cardId]);
        updateStats();
        updateLearningStats();
        
        const btn = event.target.closest('.correct-btn');
        if (btn) {
            btn.disabled = true;
            setTimeout(() => updateButtonsState(cardId), 300);
        }
    }
}

// === 標記複習 ===
function markReview(cardId, event) {
    stopPropagation(event);
    if (starData[cardId] > 0) {
        starData[cardId]--;
        saveStarData();
        createStars(cardId, starData[cardId]);
        updateStats();
        updateLearningStats();
        
        const btn = event.target.closest('.review-btn');
        if (btn) {
            btn.disabled = true;
            setTimeout(() => updateButtonsState(cardId), 300);
        }
    }
}

// === 更新統計 ===
function updateStats() {
    if (!appData) return;
    
    const wordIds = appData.words?.map(word => word.id) || [];
    const sentenceIds = appData.sentences?.map(sentence => sentence.id) || [];
    
    const wordStars = wordIds.map(id => starData[id] || 0);
    const totalWords = wordIds.length;
    const masteredWords = wordStars.filter(v => v === 5).length;
    const reviewWords = wordStars.filter(v => v < 5).length;
    const wordsMastery = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;
    
    const sentenceStars = sentenceIds.map(id => starData[id] || 0);
    const totalSentences = sentenceIds.length;
    const masteredSentences = sentenceStars.filter(v => v === 5).length;
    const reviewSentences = sentenceStars.filter(v => v < 5).length;
    const sentencesMastery = totalSentences > 0 ? Math.round((masteredSentences / totalSentences) * 100) : 0;
    
    document.getElementById('total-words').textContent = totalWords;
    document.getElementById('mastered-words').textContent = masteredWords;
    document.getElementById('review-words').textContent = reviewWords;
    document.getElementById('words-mastery').textContent = `${wordsMastery}%`;
    
    document.getElementById('total-sentences').textContent = totalSentences;
    document.getElementById('mastered-sentences').textContent = masteredSentences;
    document.getElementById('review-sentences').textContent = reviewSentences;
    document.getElementById('sentences-mastery').textContent = `${sentencesMastery}%`;
    
    const unitTitle = document.getElementById('current-unit-title');
    const unitDesc = document.getElementById('current-unit-description');
    const unitStats = document.getElementById('current-unit-stats');
    const unitProgress = document.getElementById('current-unit-progress');
    
    if (appData.unit_title) {
        unitTitle.textContent = appData.unit_title;
        unitDesc.textContent = appData.unit_description || '';
        unitStats.textContent = `${totalWords} 詞彙 | ${totalSentences} 句子`;
        
        const totalItems = totalWords + totalSentences;
        const totalMastered = masteredWords + masteredSentences;
        const overallMastery = totalItems > 0 ? Math.round((totalMastered / totalItems) * 100) : 0;
        unitProgress.textContent = `掌握度: ${overallMastery}%`;
        
        if (learningStats[currentUnitId]) {
            learningStats[currentUnitId].mastery = overallMastery;
            saveLearningStats();
        }
    }
}

// === 分頁管理 ===
function showTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName + '-stats').classList.add('active');
    
    document.querySelectorAll('.cards-section').forEach(section => section.classList.remove('active'));
    document.getElementById(tabName + '-cards').classList.add('active');
}

// === 重置當前單元 ===
function resetCurrentTabData(event) {
    stopPropagation(event);
    if (!appData || !confirm('確定要重置當前單元的學習進度嗎？')) return;
    
    const activeTab = document.querySelector('.tab-btn.active')?.textContent.toLowerCase() || '';
    const isWordsTab = activeTab.includes('單詞');
    const isSentencesTab = activeTab.includes('句子');
    
    if (isWordsTab) {
        appData.words?.forEach(word => starData[word.id] = 0);
    } else if (isSentencesTab) {
        appData.sentences?.forEach(sentence => starData[sentence.id] = 0);
    }
    
    saveStarData();
    Object.keys(starData).forEach(key => createStars(key, starData[key]));
    updateStats();
    document.querySelectorAll('.flashcard').forEach(card => {
        card.classList.remove('flipped');
        const cardId = getCardId(card);
        if (cardId) disableButtons(cardId);
    });
    alert('當前單元進度已重置！');
}

// === 重置所有單元 ===
function resetAllUnitsData(event) {
    stopPropagation(event);
    if (!confirm('確定要重置所有單元的學習進度嗎？')) return;
    
    localStorage.removeItem('starData');
    localStorage.removeItem('learningStats');
    starData = {};
    learningStats = {};
    
    if (appData) {
        initStarData();
        initLearningStats();
        Object.keys(starData).forEach(key => createStars(key, starData[key]));
        updateStats();
    }
    alert('所有學習進度已重置！');
}

// === 數據導入導出 ===
function exportData() {
    const exportData = {
        starData: JSON.parse(localStorage.getItem('starData') || '{}'),
        learningStats: JSON.parse(localStorage.getItem('learningStats') || '{}'),
        exportDate: new Date().toISOString(),
        version: '1.0'
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `english-dictation-backup-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    alert('學習數據已導出！');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importData = JSON.parse(e.target.result);
                if (confirm('確定要導入學習數據嗎？這將覆蓋現有的學習記錄。')) {
                    if (importData.starData) localStorage.setItem('starData', JSON.stringify(importData.starData));
                    if (importData.learningStats) localStorage.setItem('learningStats', JSON.stringify(importData.learningStats));
                    if (currentUnitId) loadUnit(currentUnitId);
                    alert('學習數據導入成功！');
                }
            } catch (error) {
                alert('文件格式錯誤，無法導入數據。');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function showHelp() {
    alert(`英語默書練習系統 使用說明：\n1. 選擇單元...`);
}

function updateUrlParam(key, value) {
    const url = new URL(window.location);
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url);
}

function getUrlParam(key) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(key);
}

// ============= 新增：練習題渲染函數 =============
function renderExercises() {
    if (!appData) return;

    if (appData.exercises?.vocabDrag) {
        document.getElementById('vocab-drag-section').style.display = 'block';
        renderVocabDrag(appData.exercises.vocabDrag);
    } else {
        document.getElementById('vocab-drag-section').style.display = 'none';
    }

    if (appData.exercises?.cloze) {
        document.getElementById('cloze-section').style.display = 'block';
        document.getElementById('cloze-text').innerHTML = appData.exercises.cloze.text;
        initAdaptiveInputs('#cloze-text .cloze-input');
    } else {
        document.getElementById('cloze-section').style.display = 'none';
    }

    if (appData.exercises?.sevenFive) {
        document.getElementById('sevenfive-section').style.display = 'block';
        renderSevenFive(appData.exercises.sevenFive);
    } else {
        document.getElementById('sevenfive-section').style.display = 'none';
    }

    if (appData.exercises?.grammar) {
        document.getElementById('grammar-section').style.display = 'block';
        document.getElementById('grammar-text').innerHTML = appData.exercises.grammar.text;
        initAdaptiveInputs('#grammar-text .grammar-input');
    } else {
        document.getElementById('grammar-section').style.display = 'none';
    }
}

function renderVocabDrag(data) {
    const container = document.getElementById('vocab-drag-container');
    let optionsHtml = '<div class="drag-source-panel"><span class="drag-label">拖拽詞彙到空白處：</span>';
    data.options.forEach((opt, idx) => {
        optionsHtml += `<span class="drag-item" id="vd-${idx}" draggable="true">${opt}</span>`;
    });
    optionsHtml += '</div>';

    let sentencesHtml = '<div class="drag-sentences">';
    data.sentences.forEach((s, idx) => {
        sentencesHtml += `<div class="drag-sentence">${idx+1}. ${s.replace(/{{gap}}/, `<span class="dropzone" id="vd-drop-${idx}"></span>`)}</div>`;
    });
    sentencesHtml += '</div>';

    container.innerHTML = optionsHtml + sentencesHtml;

    vocabDragManager = new DragDropManager({
        dropzoneClass: '.dropzone',
        dragItemClass: '.drag-item',
        onDrop: (dropzone) => {
            const content = dropzone.textContent.trim();
            dropzone.style.minWidth = `${Math.max(80, content.length * 12)}px`;
        }
    });
    vocabDragManager.init();
}

function renderSevenFive(data) {
    const container = document.getElementById('sevenfive-drag-container');
    let optionsHtml = '<div class="drag-source-panel"><span class="drag-label">拖拽短語到正確位置：</span>';
    data.options.forEach((opt, idx) => {
        optionsHtml += `<span class="drag-item" id="sf-${idx}" draggable="true">${opt.text}</span>`;
    });
    optionsHtml += '</div>';
    container.innerHTML = optionsHtml;
    document.getElementById('sevenfive-text').innerHTML = data.text;

    if (!dragManager) {
        dragManager = new DragDropManager({
            dropzoneClass: '.seven-five-dropzone',
            dragItemClass: '.drag-item'
        });
        dragManager.init();
    }
}

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
            drop.innerHTML = `<span style="color:#b91c1c;">✗</span> ${correctAns}`;
        }
    });
    showFeedback('vocab-drag-feedback', correct, answers.length);
}

function undoVocabDrag() { vocabDragManager?.undo(); }
function resetVocabDrag() { vocabDragManager?.reset(); renderVocabDrag(appData.exercises.vocabDrag); }

function undoSevenFiveDrag() { dragManager?.undo(); }
function resetSevenFive() { dragManager?.reset(); renderSevenFive(appData.exercises.sevenFive); }

function checkSevenFive() {
    // 簡化版本，實際應比對答案
    showFeedback('sevenfive-feedback', 5, 5);
}

function checkCloze() { showFeedback('cloze-feedback', 3, 3); }
function resetCloze() { 
    document.querySelectorAll('#cloze-text .cloze-input').forEach(input => {
        input.value = '';
        input.style.width = '1.8em';
        input.classList.remove('correct', 'incorrect');
    });
}

function checkGrammar() { showFeedback('grammar-feedback', 2, 2); }
function resetGrammar() {
    document.querySelectorAll('#grammar-text .grammar-input').forEach(input => {
        input.value = '';
        input.style.width = '1.5em';
        input.classList.remove('correct', 'incorrect');
    });
}

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

// === 單元加載（擴展版）===
async function loadUnit(unitId) {
    if (!unitId || unitId === currentUnitId) return;
    
    currentUnitId = unitId;
    
    document.getElementById('words-grid').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 載入單元中...</div>';
    document.getElementById('sentences-grid').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 載入單元中...</div>';
    
    const success = await loadUnitData(unitId);
    
    if (success) {
        initStarData();
        initLearningStats();
        generateCards();
        
        Object.keys(starData).forEach(key => {
            createStars(key, starData[key]);
            disableButtons(key);
        });
        
        document.getElementById('unit-select').value = unitId;
        updateLearningStats();
        updateUrlParam('unit', unitId);
        
        // ★ 新增：渲染練習題
        renderExercises();
        // ★ 新增：啟動計時器
        learningTimer.start();
        
        console.log(`單元 ${unitId} 加載成功`);
    } else {
        document.getElementById('words-grid').innerHTML = '<div class="loading">單元加載失敗，請刷新頁面重試。</div>';
        document.getElementById('sentences-grid').innerHTML = '';
    }
}

// === 初始化頁面 ===
async function initPage() {
    console.log('初始化頁面...');
    
    // 加載單元索引
    const indexLoaded = await loadUnitsIndex();
    
    if (indexLoaded && unitsIndex.units && unitsIndex.units.length > 0) {
        const unitSelect = document.getElementById('unit-select');
        unitSelect.innerHTML = '';
        
        unitsIndex.units.forEach(unit => {
            const option = document.createElement('option');
            option.value = unit.id;
            option.textContent = unit.title;
            unitSelect.appendChild(option);
        });
        
        let unitToLoad = getUrlParam('unit');
        if (!unitToLoad || !unitsIndex.units.find(u => u.id === unitToLoad)) {
            unitToLoad = CONFIG.DEFAULT_UNIT;
        }
        
        await loadUnit(unitToLoad);
        
        unitSelect.addEventListener('change', function() {
            learningTimer.saveTime();
            loadUnit(this.value);
        });
    } else {
        document.getElementById('words-grid').innerHTML = '<div class="loading">無法載入單元列表，請檢查網絡連接。</div>';
        document.getElementById('sentences-grid').innerHTML = '';
    }
    
    // 初始化圖片錯誤處理
    initImageFallback();
    
    // 頁面卸載時保存時間
    window.addEventListener('beforeunload', () => learningTimer.saveTime());
}

// 頁面加載完成時初始化
window.addEventListener('load', initPage);
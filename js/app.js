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
let ttsVoices = [];

// === 音頻播放器（支援本地MP3 + TTS備援）===
class AudioPlayer {
    constructor() {
        this.currentAudio = null;
        this.currentBtn = null;
        this.isPlaying = false;
    }

    stopCurrent() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (this.currentBtn) {
            this.currentBtn.classList.remove('playing', 'loading');
            this.currentBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            this.currentBtn.disabled = false;
            this.currentBtn = null;
        }
        this.isPlaying = false;
    }

    async play(text, btn, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (this.isPlaying && this.currentBtn === btn) {
            this.stopCurrent();
            return;
        }
        if (this.isPlaying) this.stopCurrent();

        btn.classList.add('loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        this.currentBtn = btn;

        try {
            // 嘗試本地MP3
            if (CONFIG.ENABLE_LOCAL_AUDIO) {
                const audioFile = `${CONFIG.AUDIO_PATH}${currentUnitId}/${text}.mp3`;
                const audio = new Audio(audioFile);
                await new Promise((resolve, reject) => {
                    audio.oncanplaythrough = () => {
                        audio.play()
                            .then(() => {
                                this.currentAudio = audio;
                                this.isPlaying = true;
                                btn.classList.remove('loading');
                                btn.classList.add('playing');
                                btn.innerHTML = '<i class="fas fa-stop"></i>';
                                audio.onended = () => this.stopCurrent();
                                resolve();
                            })
                            .catch(reject);
                    };
                    audio.onerror = reject;
                    setTimeout(() => reject('timeout'), 2000);
                });
                return;
            }
            throw new Error('本地音頻不可用');
        } catch {
            // TTS備援
            if (CONFIG.ENABLE_TTS_FALLBACK && window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'en-GB';
                utterance.rate = 0.85;
                utterance.onstart = () => {
                    btn.classList.remove('loading');
                    btn.classList.add('playing');
                    btn.innerHTML = '<i class="fas fa-stop"></i>';
                    this.isPlaying = true;
                };
                utterance.onend = () => this.stopCurrent();
                utterance.onerror = () => this.stopCurrent();
                window.speechSynthesis.speak(utterance);
            }
        }
    }
}
const audioPlayer = new AudioPlayer();

// === 加載單元索引 ===
async function loadUnitsIndex() {
    try {
        const response = await fetch(CONFIG.DATA_PATH + CONFIG.UNITS_INDEX);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        unitsIndex = await response.json();
        console.log('單元索引載入成功:', unitsIndex);
        return true;
    } catch (error) {
        console.error('單元索引載入失敗:', error);
        unitsIndex = [];
        return false;
    }
}

// === 加載單元數據 ===
async function loadUnitData(unitId) {
    try {
        const response = await fetch(`${CONFIG.DATA_PATH}${unitId}.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        appData = await response.json();
        console.log(`單元 ${unitId} 載入成功:`, appData.unitName);
        return true;
    } catch (error) {
        console.error(`單元 ${unitId} 載入失敗:`, error);
        return false;
    }
}

// === 渲染文章 ===
function renderArticle() {
    if (!appData?.article) return;
    
    document.getElementById('article-title').innerHTML = appData.article.title.replace('\n', '<br>');
    
    const img = document.getElementById('article-illustration');
    if (appData.article.illustration) {
        img.src = appData.article.illustration;
    }
    
    const container = document.getElementById('article-content');
    container.innerHTML = '';
    
    appData.article.paragraphs.forEach((para, index) => {
        const paraDiv = document.createElement('div');
        paraDiv.className = 'paragraph';
        paraDiv.innerHTML = `
            <div class="paragraph-text">${para.english}</div>
            <div class="paragraph-controls">
                <button class="btn-icon" onclick="audioPlayer.play('${para.english.replace(/'/g, "\\'")}', this, event)">
                    <i class="fas fa-volume-up"></i> 朗讀
                </button>
                <button class="btn-icon" onclick="this.nextElementSibling.classList.toggle('show')">
                    <i class="fas fa-language"></i> 翻譯
                </button>
                <button class="btn-icon" onclick="this.nextElementSibling.nextElementSibling.classList.toggle('show')">
                    <i class="fas fa-lightbulb"></i> 解讀
                </button>
            </div>
            <div class="translation-content">${para.translation}</div>
            <div class="implication-content">
                <div>${para.implication.english}</div>
                <div style="color: #666; margin-top: 8px;">${para.implication.chinese}</div>
            </div>
        `;
        container.appendChild(paraDiv);
    });
}

// === 渲染詞彙表 ===
function renderVocabulary() {
    if (!appData?.vocabulary) return;
    
    const grid = document.getElementById('vocab-grid');
    grid.innerHTML = '';
    
    appData.vocabulary.forEach((vocab, index) => {
        const card = document.createElement('div');
        card.className = `vocab-card ${vocab.highlightClass}`;
        card.innerHTML = `
            <div class="vocab-number">${index + 1}</div>
            <button class="vocab-audio-btn" onclick="audioPlayer.play('${vocab.word.replace(/'/g, "\\'")}', this, event)">
                <i class="fas fa-volume-up"></i>
            </button>
            <div class="vocab-word">${vocab.word}</div>
            <div class="vocab-meaning">${vocab.meaning}</div>
        `;
        grid.appendChild(card);
    });
}

// === 渲染閱讀理解 ===
function renderReading() {
    if (!appData?.readingComprehension) return;
    
    const container = document.getElementById('reading-container');
    container.innerHTML = '';
    
    appData.readingComprehension.forEach((item, idx) => {
        const q = document.createElement('div');
        q.className = 'reading-question';
        q.innerHTML = `
            <div class="question-text">${item.question}</div>
            <div class="options">
                ${item.options.map(opt => `
                    <label class="option">
                        <input type="radio" name="q${idx}" value="${opt.id}">
                        <span>${opt.text}</span>
                    </label>
                `).join('')}
            </div>
            <div class="question-feedback" id="feedback-q${idx}"></div>
        `;
        container.appendChild(q);
    });
    
    // 加入檢查按鈕
    const btnDiv = document.createElement('div');
    btnDiv.className = 'action-buttons';
    btnDiv.innerHTML = `
        <button class="btn-check" onclick="checkReading()">
            <i class="fas fa-check-circle"></i> 檢查答案
        </button>
        <button class="btn-reset" onclick="resetReading()">
            <i class="fas fa-undo-alt"></i> 重新選擇
        </button>
    `;
    container.appendChild(btnDiv);
}

// === 渲染完形填空 ===
function renderCloze() {
    if (!appData?.clozeText) return;
    
    const container = document.getElementById('cloze-container');
    container.innerHTML = `
        <div class="cloze-text">${appData.clozeText}</div>
        <div class="action-buttons">
            <button class="btn-check" onclick="checkCloze()">
                <i class="fas fa-check-circle"></i> 檢查答案
            </button>
            <button class="btn-reset" onclick="resetCloze()">
                <i class="fas fa-undo-alt"></i> 清除答案
            </button>
        </div>
        <div class="feedback-area" id="cloze-feedback"></div>
    `;
}

// === 渲染句子配對 ===
function renderSevenFive() {
    if (!appData?.sevenFive) return;
    
    const container = document.getElementById('sevenfive-container');
    container.innerHTML = `
        <div class="sevenfive-text">${appData.sevenFive.text}</div>
        <div class="action-buttons">
            <button class="btn-check" onclick="alert('請實作答案檢查')">
                <i class="fas fa-check-circle"></i> 檢查答案
            </button>
            <button class="btn-reset" onclick="window.location.reload()">
                <i class="fas fa-undo-alt"></i> 重新開始
            </button>
        </div>
    `;
}

// === 渲染語法填空 ===
function renderGrammar() {
    if (!appData?.grammarText) return;
    
    const container = document.getElementById('grammar-container');
    container.innerHTML = `
        <div class="grammar-text">${appData.grammarText}</div>
        <div class="action-buttons">
            <button class="btn-check" onclick="checkGrammar()">
                <i class="fas fa-check-circle"></i> 檢查答案
            </button>
            <button class="btn-reset" onclick="resetGrammar()">
                <i class="fas fa-undo-alt"></i> 清除答案
            </button>
        </div>
        <div class="feedback-area" id="grammar-feedback"></div>
    `;
}

// === 答案檢查函數（簡化版）===
function checkReading() {
    if (!appData?.answers?.reading) return;
    let correct = 0;
    appData.readingComprehension.forEach((_, idx) => {
        const selected = document.querySelector(`input[name="q${idx}"]:checked`);
        const feedback = document.getElementById(`feedback-q${idx}`);
        if (selected?.value === appData.answers.reading[idx]) {
            correct++;
            feedback.innerHTML = '✓ 正確';
            feedback.className = 'question-feedback correct';
        } else {
            feedback.innerHTML = `✗ 正確答案: ${appData.answers.reading[idx]}`;
            feedback.className = 'question-feedback incorrect';
        }
    });
    alert(`閱讀理解: 答對 ${correct}/${appData.readingComprehension.length} 題`);
}

function checkCloze() {
    if (!appData?.answers?.cloze) return;
    const inputs = document.querySelectorAll('#cloze-container .cloze-input');
    let correct = 0;
    inputs.forEach((input, idx) => {
        if (input.value.trim().toLowerCase() === appData.answers.cloze[idx].toLowerCase()) {
            input.classList.add('correct');
            correct++;
        } else {
            input.classList.add('incorrect');
        }
    });
    document.getElementById('cloze-feedback').innerHTML = 
        `完形填空: 答對 ${correct}/${inputs.length}`;
    document.getElementById('cloze-feedback').style.display = 'block';
}

function checkGrammar() {
    if (!appData?.answers?.grammar) return;
    const inputs = document.querySelectorAll('#grammar-container .grammar-input');
    let correct = 0;
    inputs.forEach((input, idx) => {
        if (input.value.trim().toLowerCase() === appData.answers.grammar[idx].toLowerCase()) {
            input.classList.add('correct');
            correct++;
        } else {
            input.classList.add('incorrect');
        }
    });
    document.getElementById('grammar-feedback').innerHTML = 
        `語法填空: 答對 ${correct}/${inputs.length}`;
    document.getElementById('grammar-feedback').style.display = 'block';
}

function resetReading() {
    document.querySelectorAll('#reading-container input[type="radio"]').forEach(r => r.checked = false);
    document.querySelectorAll('.question-feedback').forEach(f => f.innerHTML = '');
}

function resetCloze() {
    document.querySelectorAll('#cloze-container .cloze-input').forEach(input => {
        input.value = '';
        input.classList.remove('correct', 'incorrect');
    });
    document.getElementById('cloze-feedback').style.display = 'none';
}

function resetGrammar() {
    document.querySelectorAll('#grammar-container .grammar-input').forEach(input => {
        input.value = '';
        input.classList.remove('correct', 'incorrect');
    });
    document.getElementById('grammar-feedback').style.display = 'none';
}

// === 單元加載 ===
async function loadUnit(unitId) {
    if (!unitId) return;
    currentUnitId = unitId;
    
    const success = await loadUnitData(unitId);
    if (success) {
        renderArticle();
        renderVocabulary();
        renderReading();
        renderCloze();
        renderSevenFive();
        renderGrammar();
        
        document.getElementById('current-unit-title').innerHTML = appData.unitName || unitId;
        document.getElementById('unit-select').value = unitId;
        console.log(`✅ 單元 ${unitId} 載入完成`);
    }
}

// === 初始化頁面 ===
async function initPage() {
    console.log('初始化頁面...');
    
    const indexLoaded = await loadUnitsIndex();
    if (indexLoaded && unitsIndex.length > 0) {
        const select = document.getElementById('unit-select');
        select.innerHTML = '';
        
        unitsIndex.forEach(unit => {
            const option = document.createElement('option');
            option.value = unit.unitId;
            option.textContent = unit.unitName;
            select.appendChild(option);
        });
        
        let unitToLoad = CONFIG.DEFAULT_UNIT;
        if (unitsIndex.find(u => u.unitId === unitToLoad)) {
            await loadUnit(unitToLoad);
        }
        
        select.addEventListener('change', (e) => loadUnit(e.target.value));
    }
}

// 啟動
window.addEventListener('load', initPage);
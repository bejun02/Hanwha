
const EXCHANGE_API = 'https://open.er-api.com/v6/latest/KRW';
let currentExchangeRate = 0; // 1 KRW = X MYR
let assetsChart;
let compareChart; // Added global variable for split view
let gaugeChart;
let calculatedNetAsset = 0; // Fixed: Global variable restored

// V6.0 Stress Factors
let stressRateFlag = false;
let stressYieldFlag = false;
const INFLATION_RATE = 0.03; // 3% Annual Inflation

// V7.0 Cost Indices (Korea -> Malaysia)
const COST_INDICES = {
    food: 0.44, // 44% of Korea
    market: 0.6,
    trans: 0.5,
    util: 0.4,
    fixed: 0.8,
    rent: 1.0   // 1.0 (Direct Local Rent)
};

document.addEventListener('DOMContentLoaded', () => {
    fetchExchangeRate();
    setupEventListeners();
    initModalLogic(); // V5.0 Asset Modal
    loadFromLocal();
});

async function fetchExchangeRate() {
    try {
        const res = await fetch(EXCHANGE_API);
        const data = await res.json();
        currentExchangeRate = data.rates.MYR; // 1 KRW = X MYR

        // UI Display (1 MYR = ? KRW)
        const rateInverse = 1 / currentExchangeRate;
        document.getElementById('exchangeRatDisplay').innerHTML =
            `1 MYR = <strong style="color:var(--text-main)">${rateInverse.toFixed(2)}</strong> KRW`;

        calculateAll();
    } catch (e) {
        console.error("Exchange Rate Error", e);
        // Fallback
        currentExchangeRate = 1 / 300;
        document.getElementById('exchangeRatDisplay').textContent = "Offline Mode (1 MYR = 300 KRW)";
        calculateAll();
    }
}

function setupEventListeners() {
    // Inputs (comma format)

    // Income Inputs
    // document.getElementById('incomeKRW').addEventListener('keyup', (e) => { formatNumberInput(e.target); calculateAll(); }); // Removed
    document.getElementById('salaryMYR').addEventListener('keyup', (e) => { formatNumberInput(e.target); calculateAll(); });

    // Initial Cost Inputs
    document.getElementById('costVisa').addEventListener('keyup', (e) => { formatNumberInput(e.target); calculateAll(); });
    document.getElementById('costMove').addEventListener('keyup', (e) => { formatNumberInput(e.target); calculateAll(); });
    document.getElementById('costDeposit').addEventListener('keyup', (e) => { formatNumberInput(e.target); calculateAll(); });

    // Housing Type
    document.querySelectorAll('input[name="housingType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            toggleRentInput(radio.value);
            calculateAll();
        });
    });

    // Sliders
    setupSlider('sliderRent', 'valRent', 'expenseRent');
    setupSlider('sliderFood', 'valFood', 'expenseFood');
    setupSlider('sliderMarket', 'valMarket', 'expenseMarket');
    setupSlider('sliderTransport', 'valTransport', 'expenseTransport');
    setupSlider('sliderUtility', 'valUtility', 'expenseUtility');
    setupSlider('sliderFixed', 'valFixed', 'expenseFixed');

    // Income Slider
    const iSlider = document.getElementById('sliderInterest');
    const iVal = document.getElementById('valInterest');
    iSlider.addEventListener('input', () => {
        iVal.textContent = iSlider.value + '%';
        calculateAll();
    });

    // Reset
    document.getElementById('resetBtn').addEventListener('click', () => {
        localStorage.clear(); location.reload();
    });

    // V6.0 Stress Buttons
    document.getElementById('btnStressRate').addEventListener('click', function () {
        stressRateFlag = !stressRateFlag;
        this.classList.toggle('active', stressRateFlag);
        calculateAll();
    });
    document.getElementById('btnStressYield').addEventListener('click', function () {
        stressYieldFlag = !stressYieldFlag;
        this.classList.toggle('active', stressYieldFlag);
        calculateAll();
    });
    document.getElementById('btnStressReset').addEventListener('click', function () {
        stressRateFlag = false;
        stressYieldFlag = false;
        document.getElementById('btnStressRate').classList.remove('active');
        document.getElementById('btnStressYield').classList.remove('active');
        calculateAll();
    });
}

function initModalLogic() {
    const modal = document.getElementById('assetModal');
    const openBtn = document.getElementById('btnOpenModal');
    const closeBtn = document.getElementById('btnCloseModal');
    const applyBtn = document.getElementById('btnApplyAsset');

    // Open/Close
    openBtn.addEventListener('click', () => { modal.classList.add('open'); recalculateTaxModal(); });
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            document.getElementById(t.dataset.tab).classList.add('active');
        });
    });

    // Inputs in Modal -> Trigger Recalc
    const inputs = ['propSell', 'propBuy', 'propYears', 'propOneHouse', 'stockSell', 'stockBuy', 'stockOverseas', 'cashAmount', 'fxSpread'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', (e) => {
            if (e.target.type === 'text') formatNumberInput(e.target);
            if (id === 'fxSpread') document.getElementById('fxSpreadVal').textContent = e.target.value + '%';
            recalculateTaxModal();
        });
        if (el && el.type === 'checkbox') el.addEventListener('change', recalculateTaxModal);
    });

    // Apply Button
    applyBtn.addEventListener('click', () => {
        // Update Main Dashboard
        document.getElementById('totalAssetsDisplay').value = calculatedNetAsset.toLocaleString();
        document.getElementById('netAssetPreview').textContent = calculatedNetAsset.toLocaleString() + ' 원';

        // Save to Local
        saveToLocal();

        // Trigger Main Sim
        calculateAll();
        modal.classList.remove('open');
    });
}

function recalculateTaxModal() {
    // 1. Real Estate Tax
    const pSell = parseNumber(document.getElementById('propSell').value);
    const pBuy = parseNumber(document.getElementById('propBuy').value);
    const pYears = parseInt(document.getElementById('propYears').value) || 0;
    const isOneHouse = document.getElementById('propOneHouse').checked;

    let propTax = 0;
    if (pSell > pBuy) {
        let gain = pSell - pBuy;
        // 1-House Exemption (12억)
        if (isOneHouse && pSell > 1200000000) {
            gain = gain * ((pSell - 1200000000) / pSell);
        } else if (isOneHouse && pSell <= 1200000000) {
            gain = 0;
        }

        // Long-term deduction (Simplified)
        let deductRate = 0;
        if (isOneHouse) deductRate = Math.min(pYears * 0.08, 0.80); // Max 80%
        else deductRate = Math.min(Math.max(pYears - 3, 0) * 0.02, 0.30); // General

        if (pYears < 3) deductRate = 0;

        let taxBase = gain - (gain * deductRate) - 2500000; // Basic deduction
        if (taxBase < 0) taxBase = 0;

        // KR Tax Rates 2024
        propTax = calcProgressiveTax(taxBase);
    }
    document.getElementById('estPropTax').textContent = Math.round(propTax).toLocaleString() + ' 원';

    // 2. Stock Tax
    const sSell = parseNumber(document.getElementById('stockSell').value);
    const sBuy = parseNumber(document.getElementById('stockBuy').value);
    const isOver = document.getElementById('stockOverseas').checked;
    let stockTax = 0;
    if (sSell > sBuy) {
        const sGain = sSell - sBuy;
        const deduction = 2500000;
        if (sGain > deduction) {
            stockTax = (sGain - deduction) * 0.22; // 22% (Income + Local)
        }
    }
    document.getElementById('estStockTax').textContent = Math.round(stockTax).toLocaleString() + ' 원';

    // 3. Totals
    const cash = parseNumber(document.getElementById('cashAmount').value);
    const grossTotal = pSell + sSell + cash;
    const totalTax = propTax + stockTax;

    // 4. FX Cost
    const spread = parseFloat(document.getElementById('fxSpread').value) / 100;
    const liquidAmount = grossTotal - totalTax;
    const fxCost = (liquidAmount * spread) + 5000; // + 5000 krw fixed fee

    const finalNet = liquidAmount - fxCost;

    // UI Update
    document.getElementById('modalGross').textContent = grossTotal.toLocaleString();
    document.getElementById('modalTax').textContent = '- ' + Math.round(totalTax).toLocaleString();
    document.getElementById('modalFX').textContent = '- ' + Math.round(fxCost).toLocaleString();
    document.getElementById('modalNet').textContent = Math.round(finalNet).toLocaleString();

    calculatedNetAsset = finalNet > 0 ? finalNet : 0;
}

function calcProgressiveTax(base) {
    if (base <= 14000000) return base * 0.06;
    if (base <= 50000000) return (base * 0.15) - 1260000;
    if (base <= 88000000) return (base * 0.24) - 5760000;
    if (base <= 150000000) return (base * 0.35) - 15440000;
    if (base <= 300000000) return (base * 0.38) - 19940000;
    if (base <= 500000000) return (base * 0.40) - 25940000;
    if (base <= 1000000000) return (base * 0.42) - 35940000;
    return (base * 0.45) - 65940000;
}

function toggleRentInput(type) {
    const rentArea = document.getElementById('rentInputArea');
    const depositInput = document.getElementById('costDeposit');
    if (type === 'rent') {
        rentArea.style.display = 'block';
        depositInput.placeholder = '월세 x 2.5 (Auto)';
    } else {
        rentArea.style.display = 'none';
        depositInput.placeholder = '자가 시 0';
        document.getElementById('sliderRent').value = 0;
        document.getElementById('valRent').textContent = '0';
        document.getElementById('expenseRent').value = 0;
    }
}

function setupSlider(sliderId, displayId, hiddenInputId) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    const hidden = document.getElementById(hiddenInputId);

    slider.addEventListener('input', () => {
        const val = parseInt(slider.value).toLocaleString();
        display.textContent = val;
        hidden.value = slider.value;
        calculateAll();

        if (sliderId === 'sliderRent') {
            autoUpdateDeposit(slider.value);
        }
    });
}

function autoUpdateDeposit(rentVal) {
    const housing = document.querySelector('input[name="housingType"]:checked').value;
    if (housing === 'rent') {
        const deposit = Math.round(rentVal * 2.5);
        document.getElementById('costDeposit').value = deposit.toLocaleString();
    }
}

function formatNumberInput(input) {
    let val = input.value.replace(/[^0-9]/g, '');
    if (!val) { input.value = ''; return; }
    input.value = parseInt(val).toLocaleString();
}

function parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.replace(/,/g, '')) || 0;
}



/* --- V7.0 MAIN CALCULATION ENGINE --- */
function calculateAll() {
    if (!currentExchangeRate) return;

    // 1. Assets
    const netAssetsDisplay = document.getElementById('totalAssetsDisplay').value;
    const assets = parseNumber(netAssetsDisplay);

    // 2. Initial Costs
    const cVisa = parseNumber(document.getElementById('costVisa').value);
    const cMove = parseNumber(document.getElementById('costMove').value);
    const cDep = parseNumber(document.getElementById('costDeposit').value);
    const totalSetup = cVisa + cMove + cDep;

    document.getElementById('totalSetupCost').textContent = totalSetup.toLocaleString();

    // Progress Bar
    let setupPct = 0;
    if (assets > 0) setupPct = (totalSetup / assets) * 100;
    if (setupPct > 100) setupPct = 100;
    document.getElementById('setupProgressBar').style.width = setupPct + '%';

    // Net Available
    let netAssets = assets - totalSetup;

    // V6.0 Stress Factors
    let effExchangeRate = currentExchangeRate;
    if (stressRateFlag) effExchangeRate = effExchangeRate * 0.909;

    // 3. Income
    let annualInterestRate = parseFloat(document.getElementById('sliderInterest').value) || 0;
    if (stressYieldFlag) annualInterestRate = Math.max(0, annualInterestRate - 2.0);

    const monthlyInterestRate = (annualInterestRate / 100) / 12;

    const salaryMYR = parseNumber(document.getElementById('salaryMYR').value);
    const salaryToKRW = salaryMYR / effExchangeRate;

    const totalMonthlyIncome = salaryToKRW;
    document.getElementById('totalIncomeDisplay').textContent = Math.round(totalMonthlyIncome).toLocaleString();

    // 4. Expenses (Input vs Output)
    const eFood = parseInt(document.getElementById('sliderFood').value);
    const eMarket = parseInt(document.getElementById('sliderMarket').value);
    const eTrans = parseInt(document.getElementById('sliderTransport').value);
    const eUtil = parseInt(document.getElementById('sliderUtility').value);
    const eFixed = parseInt(document.getElementById('sliderFixed').value);
    const eRent = parseInt(document.getElementById('sliderRent').value);

    // Korea Original (Approximate Input)
    const koreaTotalExpense = eFood + eMarket + eTrans + eUtil + eFixed; // Rent excluded from chart comparison if it's local logic

    // Malaysia Optimized (Output)
    const lFood = eFood * COST_INDICES.food;
    const lMarket = eMarket * COST_INDICES.market;
    const lTrans = eTrans * COST_INDICES.trans;
    const lUtil = eUtil * COST_INDICES.util;
    const lFixed = eFixed * COST_INDICES.fixed;
    const lRent = eRent * COST_INDICES.rent; // Direct 1.0 if using V7.1 Logic

    const localTotalExpense = lFood + lMarket + lTrans + lUtil + lFixed + lRent;

    // Compare Visualization (Adding Rent to both sides for parity in Chart? No, Rent is usually distinct. 
    // We will compare 'Living Costs' excluding Rent for purity, or just add eRent/lRent to both.
    // For simplicity and user expectation: Input (Korea) + Rent vs Output (Local) + Rent)
    updateComparisonChart(koreaTotalExpense + eRent, localTotalExpense);

    // 5. Runway Calculation
    let months = 0;
    let currentCapital = netAssets;

    let isInfinite = false;
    let isDepleting = false; // Flag for >50y but depleting

    const chartData = [];
    const labels = [];

    chartData.push(currentCapital);
    labels.push('Start');

    // Simulation Loop (600 months / 50 Years)
    for (let i = 1; i <= 600; i++) {
        // Inflation
        let monthlyExpense = localTotalExpense;
        const yearsPassed = Math.floor((i - 1) / 12);
        if (yearsPassed > 0) {
            monthlyExpense = localTotalExpense * Math.pow(1 + INFLATION_RATE, yearsPassed);
        }

        // Interest Income (Taxed 15.4%)
        const rawInterest = currentCapital * monthlyInterestRate;
        const taxedInterest = rawInterest * (1 - 0.154);

        const totalIncome = totalMonthlyIncome + taxedInterest;
        const netFlow = totalIncome - monthlyExpense;

        currentCapital += netFlow;

        if (i % 12 === 0) {
            chartData.push(currentCapital);
            labels.push(i / 12 + '년');
        }

        if (currentCapital <= 0) {
            months = i;
            break;
        }
    }

    // Granular Runway Logic
    if (currentCapital > 0 && months === 0) {
        // Did not run out in 50 years.
        if (currentCapital >= netAssets) {
            // Capital Increased or Stayed Same -> Truly Infinite
            isInfinite = true;
            months = Infinity;
        } else {
            // Capital Decreased -> Will run out eventually
            isDepleting = true;
            // Linear extrapolation for simple estimate
            const avgBurn = (netAssets - currentCapital) / 600;
            const remainingMonths = currentCapital / avgBurn;
            months = 600 + Math.floor(remainingMonths);
        }
    }

    // Display Runway
    const runwayDisplay = document.getElementById('runwayDisplay');
    const badge = document.getElementById('safetyBadge');

    if (isInfinite) {
        runwayDisplay.innerHTML = `무한 <small>(Infinite)</small>`;
        badge.textContent = "경제적 자립 (FIRE)";
        badge.className = "badge badge-success";
    } else if (isDepleting) {
        // More than 50 years but finite
        const totalY = Math.floor(months / 12);
        if (totalY > 999) {
            runwayDisplay.innerHTML = `무한 <small>(999년+)</small>`;
            badge.textContent = "사실상 영구";
            badge.className = "badge badge-success";
        } else {
            runwayDisplay.innerHTML = `${totalY}년 이상`;
            badge.textContent = "매우 안정 (장기)";
            badge.className = "badge badge-success";
        }
    } else {
        // Less than 50 years
        const y = Math.floor(months / 12);
        const m = months % 12;
        runwayDisplay.textContent = `${y}년 ${m}개월`;

        if (y >= 30) { badge.textContent = "안정"; badge.className = "badge badge-success"; }
        else if (y >= 15) { badge.textContent = "주의"; badge.className = "badge badge-warning"; }
        else { badge.textContent = "위험"; badge.className = "badge badge-danger"; }

        if (netAssets <= 0) {
            runwayDisplay.textContent = "자산 부족";
            badge.textContent = "즉시 고갈";
            badge.className = "badge badge-danger";
        }
    }

    // 6. Local Cost KPI
    const costMYR = localTotalExpense * effExchangeRate;
    document.getElementById('totalCostMYR').innerHTML = `<span class="currency-primary">MYR ${Math.round(costMYR).toLocaleString()}</span>`;
    document.getElementById('totalCostKRW').innerHTML = `<span class="currency-secondary">/ 약 ${Math.round(localTotalExpense / 10000)}만 원</span>`;

    updateBreakdown({ f: eFood, m: eMarket, t: eTrans, u: eUtil, x: eFixed, r: eRent },
        { f: lFood, m: lMarket, t: lTrans, u: lUtil, x: lFixed, r: lRent },
        effExchangeRate);
    updateChart(labels, chartData, isInfinite);

    // 9. Report & Insight
    updateReport(isInfinite, months, netAssets, localTotalExpense, totalMonthlyIncome, annualInterestRate);

    saveToLocal();
}

// User Request 3 & 5: Split View Chart (Korea vs Malaysia)
function updateComparisonChart(koreaExp, localExp) {
    const ctx = document.getElementById('compareChart').getContext('2d');
    const savings = koreaExp - localExp;

    if (compareChart) compareChart.destroy();

    compareChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['한국 (KRW)', '말레이시아 (KRW 환산)'],
            datasets: [{
                data: [koreaExp, localExp],
                backgroundColor: ['#3b82f6', '#10b981'], // User: Blue vs Green
                borderRadius: 4,
                barThickness: 30
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: true } }
        }
    });

    const alertBox = document.getElementById('savingsAlert');
    if (savings > 0) {
        alertBox.innerHTML = `<i class="fa-solid fa-plane-departure"></i> 이민 시 월 <strong style="color:#15803d">${Math.round(savings / 10000)}만원</strong> 절약 효과!`;
        alertBox.style.background = "#dcfce7";
        alertBox.style.color = "#15803d";
    } else {
        alertBox.innerHTML = `지출이 비슷하거나 더 높습니다.`;
        alertBox.style.background = "#f1f5f9";
    }
}

// User Request 2: Tooltips & Transparent logic
function updateBreakdown(krw, local, rate) {
    const list = document.getElementById('breakdownList');
    list.innerHTML = '';

    // Calculate Ratio for Gauge (Local Expense / Income)
    // We don't strictly need gauge update logic here if we focus on list transparency
    // But let's keep gauge working.

    // Items with Logic
    const items = [
        { l: '월세', k: krw.r, v: local.r, idx: COST_INDICES.rent, i: 'fa-house' },
        { l: '식비', k: krw.f, v: local.f, idx: COST_INDICES.food, i: 'fa-utensils' },
        { l: '마켓', k: krw.m, v: local.m, idx: COST_INDICES.market, i: 'fa-basket-shopping' },
        { l: '교통', k: krw.t, v: local.t, idx: COST_INDICES.trans, i: 'fa-bus' },
        { l: '관리비', k: krw.u, v: local.u, idx: COST_INDICES.util, i: 'fa-bolt' },
        { l: '고정비', k: krw.x, v: local.x, idx: COST_INDICES.fixed, i: 'fa-file-invoice' }
    ];

    items.sort((a, b) => b.v - a.v);

    items.forEach(item => {
        if (item.v > 0) {
            const myrVal = item.v * rate;
            const savings = Math.round((1 - item.idx) * 100);

            const tooltipText = `${item.l}: 한국 ${Math.round(item.k / 10000)}만원 → 현지 물가(${Math.round(item.idx * 100)}%) 적용 → 약 ${Math.round(item.v / 10000)}만원 (MYR ${Math.round(myrVal)})`;

            const li = document.createElement('li');
            li.className = 'list-item';
            li.innerHTML = `
                <div style="display:flex; gap:0.5rem; align-items:center">
                    <i class="fa-solid ${item.i}"></i> ${item.l}
                    <span class="conversion-icon" data-tooltip="${tooltipText}"><i class="fa-solid fa-arrow-right-arrow-left"></i></span>
                </div> 
                <div style="text-align:right">
                    <div class="currency-primary">MYR ${Math.round(myrVal).toLocaleString()}</div>
                    <div class="currency-secondary">(${Math.round(item.v / 10000)}만 원)</div>
                </div>`;
            list.appendChild(li);
        }
    });

    // Update Burn Rate Gauge (Local Expense vs Income)
    const income = parseNumber(document.getElementById('totalIncomeDisplay').textContent);
    const totalLocal = local.f + local.m + local.t + local.u + local.x + local.r;
    let ratio = income > 0 ? totalLocal / income : (totalLocal > 0 ? 1 : 0);
    if (ratio > 1) ratio = 1;

    const ctx = document.getElementById('gaugeChart').getContext('2d');
    if (gaugeChart) gaugeChart.destroy();
    gaugeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Used', 'Left'],
            datasets: [{
                data: [ratio, 1 - ratio],
                backgroundColor: [ratio > 0.8 ? '#ef4444' : '#3b82f6', '#e2e8f0'],
                borderWidth: 0,
                cutout: '80%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { tooltip: { enabled: false }, legend: { display: false } }
        }
    });
    document.getElementById('burnRateVal').textContent = (ratio * 100).toFixed(1) + '%';
}

// V6.0 Report Logic
function updateReport(isInfinite, totalMonths, netAssets, expense, income, interestRate) {
    const years = Math.floor(totalMonths / 12);

    // 1. Metrics
    document.getElementById('reportRunway').textContent = isInfinite ? "무한 (Infinite)" : `${years}년 ${totalMonths % 12}개월`;

    const gradeEl = document.getElementById('reportGrade');
    const gradeSub = document.getElementById('reportGradeSub');

    if (isInfinite || years >= 30) {
        gradeEl.textContent = "안전 (Safe)";
        gradeEl.className = "metric-value grade-safe";
        gradeSub.textContent = "30년 이상 생존 가능";
    } else if (years >= 15) {
        gradeEl.textContent = "주의 (Caution)";
        gradeEl.className = "metric-value grade-caution";
        gradeSub.textContent = "15년~30년 생존 (장기적 대비 필요)";
    } else {
        gradeEl.textContent = "위험 (Danger)";
        gradeEl.className = "metric-value grade-danger";
        gradeSub.textContent = "15년 내 고갈 위험";
    }

    // 2. Break-even Point logic
    const realYield = Math.max(0, interestRate - 3.0);
    const passiveIncome = (netAssets * (realYield / 100)) / 12;
    let requiredIncome = expense - passiveIncome;
    if (requiredIncome < 0) requiredIncome = 0;

    document.getElementById('reportBreakeven').textContent = `약 ${Math.round(requiredIncome).toLocaleString()} 원`;

    // 3. Expert Text
    const expertEl = document.getElementById('expertComment');
    let expertText = "";

    if (isInfinite) {
        expertText = `현재 귀하의 자산 구조는 **완벽한 경제적 자유** 상태입니다.\n물가 상승(3%)을 고려하더라도 자산 소득이 지출을 능가합니다.\n은퇴 후 여유로운 삶을 즐기거나, 현지 기부 및 재투자를 고려해보세요.`;
    } else if (years >= 15) {
        expertText = `현재 자산 구조는 **비교적 안정적**이나, 인플레이션 영향으로 ${years}년 뒤 자산 감소가 가속화될 수 있습니다.\n초기 10년은 여유가 있지만, 60대 이후 의료비 등 변수에 대비하여 **월 수익 ${Math.round(requiredIncome * 0.3 / 10000)}만원** 정도의 소일거리를 만드는 것을 추천합니다.`;
    } else {
        expertText = `현재 구조로는 **${years}년 내 자산 고갈**이 예상됩니다.\n가장 시급한 것은 고정 지출을 줄이는 것입니다. 특히 주거비용(Rent) 비중이 높다면 매매 전환이나 저렴한 지역 이동을 고려해야 합니다.\n초기 정착금 사용을 최소화하고 즉각적인 현금 흐름 창출이 필요합니다.`;
    }

    if (stressRateFlag || stressYieldFlag) {
        expertText += `\n\n📌 **스트레스 테스트 결과**: 위기 상황 가정 시 자산 수명이 단축되었습니다. 비상 예비비를 자산의 10% 이상 확보하세요.`;
    }
    expertEl.innerHTML = expertText.replace(/\n/g, '<br>');

    // 4. Action Plan (Reverse Calc)
    const planList = document.getElementById('actionPlanList');
    planList.innerHTML = '';

    if (!isInfinite && years < 30) {
        const save10 = expense * 0.1;
        const earn20 = expense * 0.2;

        planList.innerHTML += `<li>월 지출을 **${Math.round(save10).toLocaleString()}원 (10%)** 줄이면 수명이 약 5~8년 연장됩니다.</li>`;
        planList.innerHTML += `<li>현지에서 **${Math.round(earn20).toLocaleString()}원**의 추가 소득을 만들면 '주의' 등급으로 상향됩니다.</li>`;
        planList.innerHTML += `<li>보유 부동산/주식 중 수익률이 낮은 자산을 **배당주(4~5%)**로 리밸런싱 하세요.</li>`;
    } else {
        planList.innerHTML += `<li>현재 상태를 유지하며 **건강 관리**와 **여가 생활**에 집중하세요.</li>`;
        planList.innerHTML += `<li>상속세 및 증여 계획을 미리 수립하는 것이 좋습니다.</li>`;
    }
}

function updateChart(labels, data, isInfinite) {
    const ctx = document.getElementById('assetChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    if (isInfinite) {
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
        gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
    }

    const borderColor = isInfinite ? '#10b981' : '#2563eb';

    if (assetsChart) assetsChart.destroy();

    assetsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '예상 자산 추이 (물가상승 반영)',
                data: data,
                borderColor: borderColor,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (c) => Math.round(c.raw).toLocaleString() + ' 원' }
                }
            },
            scales: {
                y: { display: false, beginAtZero: true },
                x: { grid: { display: false } }
            }
        }
    });
}

// [Deleted V6.0 Duplicate Functions] 
// updateComparisonChart and updateBreakdown are now defined earlier with V7.0 Logic.


function saveToLocal() {
    const data = {
        assets: document.getElementById('totalAssetsDisplay').value,
        housing: document.querySelector('input[name="housingType"]:checked').value,
        sliders: {
            food: document.getElementById('sliderFood').value,
            market: document.getElementById('sliderMarket').value,
            trans: document.getElementById('sliderTransport').value,
            util: document.getElementById('sliderUtility').value,
            fixed: document.getElementById('sliderFixed').value,
            rent: document.getElementById('sliderRent').value,
            interest: document.getElementById('sliderInterest').value
        },
        setup: {
            visa: document.getElementById('costVisa').value,
            move: document.getElementById('costMove').value,
            dep: document.getElementById('costDeposit').value
        },
        income: {
            // krw: document.getElementById('incomeKRW').value, // Removed V7.0
            myr: document.getElementById('salaryMYR').value
        },
        modal: {
            pSell: document.getElementById('propSell').value,
            pBuy: document.getElementById('propBuy').value,
            pYears: document.getElementById('propYears').value,
            pOne: document.getElementById('propOneHouse').checked,
            sSell: document.getElementById('stockSell').value,
            sBuy: document.getElementById('stockBuy').value,
            sOver: document.getElementById('stockOverseas').checked,
            cash: document.getElementById('cashAmount').value,
            fx: document.getElementById('fxSpread').value
        }
    };
    localStorage.setItem('gab_save_v3', JSON.stringify(data));
}

function loadFromLocal() {
    const saved = localStorage.getItem('gab_save_v3');
    if (saved) {
        const d = JSON.parse(saved);
        if (d.assets) document.getElementById('totalAssetsDisplay').value = d.assets;
        if (d.housing) {
            const rad = document.querySelector(`input[name="housingType"][value="${d.housing}"]`);
            if (rad) { rad.checked = true; toggleRentInput(d.housing); }
        }
        if (d.sliders) {
            setSlider('Food', d.sliders.food);
            setSlider('Market', d.sliders.market);
            setSlider('Transport', d.sliders.trans);
            setSlider('Utility', d.sliders.util);
            setSlider('Fixed', d.sliders.fixed);
            setSlider('Rent', d.sliders.rent);
            const iC = document.getElementById('sliderInterest');
            if (iC && d.sliders.interest) { iC.value = d.sliders.interest; document.getElementById('valInterest').textContent = d.sliders.interest + '%'; }
        }
        if (d.setup) {
            document.getElementById('costVisa').value = d.setup.visa || 0;
            document.getElementById('costMove').value = d.setup.move || 0;
            document.getElementById('costDeposit').value = d.setup.dep || 0;
        }
        if (d.income) {
            // document.getElementById('incomeKRW').value = d.income.krw || 0; // Removed
            document.getElementById('salaryMYR').value = d.income.myr || 0;
        }
        if (d.modal) {
            document.getElementById('propSell').value = d.modal.pSell || 0;
            document.getElementById('propBuy').value = d.modal.pBuy || 0;
            document.getElementById('propYears').value = d.modal.pYears || 2;
            document.getElementById('propOneHouse').checked = d.modal.pOne;
            document.getElementById('stockSell').value = d.modal.sSell || 0;
            document.getElementById('stockBuy').value = d.modal.sBuy || 0;
            document.getElementById('stockOverseas').checked = d.modal.sOver;
            document.getElementById('cashAmount').value = d.modal.cash || 0;
            document.getElementById('fxSpread').value = d.modal.fx || 1.0;
            document.getElementById('fxSpreadVal').textContent = (d.modal.fx || 1.0) + '%';
            recalculateTaxModal();
        }
    }
}
function setSlider(name, val) {
    const s = document.getElementById('slider' + name);
    if (s) {
        s.value = val || 0;
        document.getElementById('val' + name).textContent = parseInt(val || 0).toLocaleString();
        const hid = document.getElementById('expense' + name);
        if (hid) hid.value = val || 0;
    }
}

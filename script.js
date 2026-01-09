
const EXCHANGE_API = 'https://open.er-api.com/v6/latest/KRW';
let currentExchangeRate = 0; // 1 KRW = X MYR
let assetsChart;
let compareChart; // Added global variable for split view
let cashflowChart;
let gaugeChart;
let calculatedNetAsset = 0; // Fixed: Global variable restored

// V6.0 Stress Factors
let stressRateFlag = false;
let stressYieldFlag = false;
const INFLATION_RATE = 0.03; // 3% Annual Inflation

// V7.0 Cost Indices (Korea -> Malaysia)
// V7.0 Cost Indices (Korea -> Malaysia) - Dynamic
let COST_INDICES = {
    food: 0.44, // 44% of Korea
    market: 0.6,
    trans: 0.5,
    util: 0.4,
    fixed: 0.8,
    rent: 1.0   // 1.0 (Direct Local Rent)
};

// 2024 Korea Income Tax Brackets (Tax Base -> Rate, Deduction)
const TAX_BRACKETS_2024 = [
    { limit: 14000000, rate: 0.06, deduct: 0 },
    { limit: 50000000, rate: 0.15, deduct: 1260000 },
    { limit: 88000000, rate: 0.24, deduct: 5760000 },
    { limit: 150000000, rate: 0.35, deduct: 15440000 },
    { limit: 300000000, rate: 0.38, deduct: 19940000 },
    { limit: 500000000, rate: 0.40, deduct: 25940000 },
    { limit: 1000000000, rate: 0.42, deduct: 35940000 },
    { limit: Infinity, rate: 0.45, deduct: 65940000 }
];

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
        document.getElementById('exchangeRateDisplay').innerHTML =
            `1 MYR = <strong style="color:var(--text-main)">${rateInverse.toFixed(2)}</strong> KRW`;

        calculateAll();
    } catch (e) {
        console.error("Exchange Rate Error", e);
        // Fallback
        currentExchangeRate = 1 / 300;
        document.getElementById('exchangeRateDisplay').textContent = "Offline Mode (1 MYR = 300 KRW)";
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
    openBtn.addEventListener('click', () => { modal.classList.add('open'); updateTaxModal(); });
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
    const inputs = ['propSell', 'propBuy', 'propAcqCost', 'propCapEx', 'propRentEst', 'propDepositEst', 'propYears', 'propOneHouse', 'stockSell', 'stockBuy', 'stockOverseas', 'cashAmount', 'fxSpread'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', (e) => {
            if (e.target.type === 'text') formatNumberInput(e.target);
            if (id === 'fxSpread') document.getElementById('fxSpreadVal').textContent = e.target.value + '%';
            updateTaxModal();
        });
        if (el && el.type === 'checkbox') el.addEventListener('change', updateTaxModal);
    });

    // Apply Button
    applyBtn.addEventListener('click', () => {
        // Update Main Dashboard
        document.getElementById('totalAssetsDisplay').value = calculatedNetAsset.toLocaleString();

        // Save to Local
        saveToLocal();

        // Trigger Main Sim
        calculateAll();
        modal.classList.remove('open');
    });
}

function updateTaxModal() {
    /* --- 1. Real Estate Tax Engine --- */
    const pSellElement = document.getElementById('propSell');
    const pBuyElement = document.getElementById('propBuy');

    // Safety Check
    if (!pSellElement || !pBuyElement) return;

    const pSell = parseNumber(pSellElement.value);
    const pBuy = parseNumber(pBuyElement.value);
    const pYears = parseInt(document.getElementById('propYears').value) || 0;
    const isOneHouse = document.getElementById('propOneHouse').checked;

    // Additional Costs
    const pAcq = parseNumber(document.getElementById('propAcqCost').value); // Acquisition Tax, Brokerage
    const pCap = parseNumber(document.getElementById('propCapEx').value);   // Capital Expenditure

    let propTax = 0;

    if (pSell > pBuy) {
        // Step 1: Capital Gain
        let gain = pSell - pBuy - pAcq - pCap;
        if (gain < 0) gain = 0;

        // Step 2: 1-House Exemption (Up to 12 Billion KRW)
        let taxableGain = gain;
        if (isOneHouse && pSell > 1200000000) {
            taxableGain = gain * ((pSell - 1200000000) / pSell);
        } else if (isOneHouse && pSell <= 1200000000) {
            taxableGain = 0;
        }

        // Step 3: Long-term Holding Special Deduction
        let deductRate = 0;
        if (pYears >= 3) {
            if (isOneHouse) {
                deductRate = Math.min(pYears * 0.08, 0.80);
            } else {
                deductRate = Math.min(pYears * 0.02, 0.30);
            }
        }

        const longTermDeduction = taxableGain * deductRate;
        const incomeAmount = taxableGain - longTermDeduction;

        // Step 4: Basic Deduction
        let taxBase = incomeAmount - 2500000;
        if (taxBase < 0) taxBase = 0;

        // Step 5: Calc Tax Rate
        const nationalTax = calcProgressiveTax(taxBase);

        // Step 6: Local Income Tax (10%)
        propTax = nationalTax * 1.10;
    }
    const estProp = document.getElementById('estPropTax');
    if (estProp) estProp.innerHTML = `<span style="color:#ef4444">${Math.round(propTax).toLocaleString()}</span> 원`;


    /* --- 2. Stock Tax Engine --- */
    const sSell = parseNumber(document.getElementById('stockSell').value);
    const sBuy = parseNumber(document.getElementById('stockBuy').value);

    let stockTax = 0;
    if (sSell > sBuy) {
        const sGain = sSell - sBuy;
        const deduction = 2500000;
        if (sGain > deduction) {
            stockTax = (sGain - deduction) * 0.22;
        }
    }
    document.getElementById('estStockTax').textContent = Math.round(stockTax).toLocaleString() + ' 원';


    /* --- 3. Financial Cost (FX Spread) --- */
    /* --- 3. Financial Cost (FX Spread) --- */
    const cash = parseNumber(document.getElementById('cashAmount').value);
    const depositReturn = parseNumber(document.getElementById('propDepositEst').value); // Korea Deposit Return
    let spr = parseFloat(document.getElementById('fxSpread').value);
    // We will update the 'Net Asset Preview' in main UI with this high precision value.

    // Total Tax Bill (Prop + Stock)
    const totalTaxBill = propTax + stockTax;

    // Total Liquidity (Gross)
    // Deposit is tax-free capital return
    const grossTotal = pSell + sSell + cash + depositReturn;

    // Calculate FX Cost on Liquid Assets (Gross - Tax)
    if (spr < 1.0) spr = 1.0;
    const liquidKrw = grossTotal - totalTaxBill;
    const fxCost = liquidKrw > 0 ? liquidKrw * (spr / 100) : 0;

    // Net Asset
    const finalNet = liquidKrw - fxCost;

    // Net Asset Parts (Global Storage for Sim)
    window.simPropNet = (pSell - pBuy - pAcq - pCap > 0) ? (pSell - pAcq - pCap - propTax) : (pSell - pAcq - pCap);
    // Wait, Prop Net is just Revenue (pSell) - Costs? 
    // Actually, "Liquidity" from House = SellPrice - Tax - SetupCosts(Acq/Cap already paid? No, usually subtracted from gain. Acq/Cap are past sunk costs? Or paid now?)
    // Usually pAcq/pCap are *past* costs used for tax calc. They are not *cash out* now.
    // So Cash In = Sell Price - Brokerage(New) - Tax.
    // Simplifying: Cash In = Sell Price - Tax. (Assuming Brokerage is negligible or user subtracts).
    // Let's stick to: Cash In = Sell Price - Est.Tax.
    window.simPropNet = pSell - propTax;

    window.simDepositNet = depositReturn;
    window.simCommonNet = (sSell - stockTax) + cash - fxCost; // Applying FX Cost to common logic for simplicity, or apply FX to total? FX depends on Total.

    // Recalculate FX properly based on scenario? 
    // FX Cost logic in updateTaxModal currently runs on `grossTotal`.
    // If we split, we need to apply FX to the *sum*.
    // So let's store GROSS parts.
    window.simPropGross = pSell;
    window.simPropTax = propTax;

    window.simDepositGross = depositReturn;

    window.simStockGross = sSell;
    window.simStockTax = stockTax;
    window.simCashGross = cash;
    window.simFXRate = spr;

    // We still update the modal display with the SUM (or maybe just keep it as is, but simulation uses the split).
    // User complaint: "Don't sum them in calculation".
    // V7.3 Fix: Modal Display now respects the active Housing Type to avoid confusion.

    const hType = document.querySelector('input[name="housingType"]:checked') ? document.querySelector('input[name="housingType"]:checked').value : 'buy';

    let displayGross = 0;
    let displayTax = 0;
    let displayLiquid = 0;

    // Common Parts
    const cGross = (window.simStockGross || 0) + (window.simCashGross || 0);
    const cTax = (window.simStockTax || 0);

    if (hType === 'buy') {
        displayGross = (window.simPropGross || 0) + cGross;
        displayTax = (window.simPropTax || 0) + cTax;
        displayLiquid = (window.simPropNet || 0) + window.simCommonNet;
    } else {
        displayGross = (window.simDepositGross || 0) + cGross;
        displayTax = cTax;
        displayLiquid = (window.simDepositNet || 0) + window.simCommonNet;
    }

    // FX is calculated on the scenario's Liquid
    const finalFX = displayLiquid > 0 ? displayLiquid * (spr / 100) : 0; // Approx FX logic (Sim uses simpler math, but close enough for preview)
    // Actually Sim logic: liquidKrw = Gross - Tax. fx = liquid * rate. Net = liquid - fx.
    // Let's match Sim logic exactly:
    const dLiquidPreFX = displayGross - displayTax;
    const dFX = dLiquidPreFX > 0 ? dLiquidPreFX * (spr / 100) : 0;
    const dNet = Math.floor(dLiquidPreFX - dFX);

    calculatedNetAsset = (dNet > 0) ? dNet : 0;

    // ... existing modal update code ...
    document.getElementById('modalGross').textContent = displayGross.toLocaleString();
    document.getElementById('modalTax').textContent = '- ' + Math.round(displayTax).toLocaleString();
    document.getElementById('modalFX').textContent = '- ' + Math.round(dFX).toLocaleString();
    document.getElementById('modalNet').textContent = calculatedNetAsset.toLocaleString();
}


function calcProgressiveTax(base) {
    if (base <= 0) return 0;

    for (let i = 0; i < TAX_BRACKETS_2024.length; i++) {
        const b = TAX_BRACKETS_2024[i];
        if (base <= b.limit) {
            return (base * b.rate) - b.deduct;
        }
    }
    // Fallback (should be covered by Infinity)
    return (base * 0.45) - 65940000;
}

function toggleRentInput(type) {
    const rentArea = document.getElementById('rentInputArea');
    // V7.2 Enhancement: We now calculate Rent from Asset Modal (KR Rent * Ratio).
    // The manual Local Rent slider is redundant, so we keep it hidden.
    if (rentArea) rentArea.style.display = 'none';
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



/* --- V7.2 SIMULATION ENGINE --- */
// Constants
const HOUSING_BUY_RATIO = 0.55; // Multiplier to estimate MYR Property Price from KRW Property

function calculateAll() {
    try {
        if (!currentExchangeRate) return;

        // 1. Get Assets (Dynamic Calculation based on Housing Choice)
        // Ensure values are fresh
        if (typeof window.simPropGross === 'undefined') updateTaxModal();

        const housingType = document.querySelector('input[name="housingType"]:checked').value; // 'rent' or 'buy'

        let simGross = 0;
        let simTax = 0;

        // Common Assets
        const commonGross = (window.simStockGross || 0) + (window.simCashGross || 0);
        const commonTax = (window.simStockTax || 0);

        if (housingType === 'buy') {
            // Scenario A: Sell KR House
            simGross = (window.simPropGross || 0) + commonGross;
            simTax = (window.simPropTax || 0) + commonTax;
        } else {
            // Scenario B: Return KR Deposit
            simGross = (window.simDepositGross || 0) + commonGross;
            simTax = commonTax; // No property tax on deposit return
            // Note: We ignore window.simPropTax here as we assume House is kept/not sold? 
            // Or if user meant "Sell House AND Rent Local", this logic limits it.
            // But aligned with user request: "Don't sum both."
        }

        // FX Cost
        const spread = (window.simFXRate || 1.0); // %
        const liquidKrw = simGross - simTax;
        const fxCost = liquidKrw > 0 ? liquidKrw * (spread / 100) : 0;

        let finalAssets = Math.floor(liquidKrw - fxCost);
        if (finalAssets < 0) finalAssets = 0;

        // Update Main Display
        document.getElementById('totalAssetsDisplay').value = finalAssets.toLocaleString();

        // 2. Initial Costs (Visa, Move, Setup)
        const cVisa = parseNumber(document.getElementById('costVisa').value);
        const cMove = parseNumber(document.getElementById('costMove').value);
        const cDep = parseNumber(document.getElementById('costDeposit').value);
        const totalSetup = cVisa + cMove + cDep;

        document.getElementById('totalSetupCost').textContent = totalSetup.toLocaleString();

        // Progress Bar
        let setupPct = 0;
        if (finalAssets > 0) setupPct = (totalSetup / finalAssets) * 100;
        if (setupPct > 100) setupPct = 100;
        document.getElementById('setupProgressBar').style.width = setupPct + '%';

        // 3. Subtract Initial Costs from Asset
        let currentAsset = finalAssets - totalSetup;

        // 4. Housing Logic (Buy vs Rent)
        // housingType is already defined above

        // User Specified Ratios
        // market: 0.45 * (2/3) ~= 0.30
        // dining: 0.44 * (2/3) ~= 0.29
        // transport: 0.50
        // utility: Buy(0.65) / Rent(0.45)
        // rent: Buy(0) / Rent(0.58)

        // Update Global COST_INDICES for Charts
        COST_INDICES.market = 0.45 * (2 / 3);
        COST_INDICES.food = 0.44 * (2 / 3); // Dining
        COST_INDICES.trans = 0.50;
        COST_INDICES.fixed = 0.70; // Ensure fixed is also set

        let localRentCost = 0;

        const deductionEl = document.getElementById('housingDeductionInfo');
        if (housingType === 'buy') {
            // Option A: Buying a House in Malaysia
            COST_INDICES.rent = 0;
            COST_INDICES.util = 0.65;

            // Estimate Purchase Price based on Korean Property Benchmark
            const krwSellPrice = parseNumber(document.getElementById('propSell').value);
            if (krwSellPrice > 0) {
                const myrHousePrice = krwSellPrice * HOUSING_BUY_RATIO;
                currentAsset -= myrHousePrice; // Assets reduced

                // Visual Confirmation
                if (deductionEl) {
                    const ok = Math.floor(myrHousePrice / 100000000);
                    const man = Math.round((myrHousePrice % 100000000) / 10000);
                    const formatStr = ok > 0 ? `${ok}억 ${man > 0 ? man.toLocaleString() + '만' : ''}` : `${man.toLocaleString()}만`;

                    deductionEl.innerHTML = `<i class="fa-solid fa-check"></i> 현지 주택 구입: 자산에서 약 <strong>${formatStr}원</strong> 차감됨`;
                }
            } else {
                // Warning if Sell Price is missing
                if (deductionEl) {
                    deductionEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> 매매 시뮬레이션을 위해 '자산설정 > 부동산'에서 <strong>매도 금액</strong>을 입력해주세요.</span>`;
                }
            }

        } else {
            // Option B: Renting
            COST_INDICES.rent = 0.58;
            COST_INDICES.util = 0.45;
            if (deductionEl) deductionEl.innerHTML = ""; // Clear info

            // Calculate Rent
            // User said: "Convert Inputted Rent to local ratio"
            const krwRentEst = parseNumber(document.getElementById('propRentEst').value);
            if (krwRentEst > 0) {
                localRentCost = krwRentEst * COST_INDICES.rent;
            } else {
                // Fallback to Slider if benchmarking input is missing
                const sliderRent = parseFloat(document.getElementById('sliderRent').value) || 0;
                // Let's use sliderRent as "User's Korean Rent" if propRentEst is empty.
                if (sliderRent > 0) localRentCost = sliderRent * COST_INDICES.rent;
            }
        }
        // 5. Monthly Expenses (KRW -> MYR equivalent)
        const expFood = parseFloat(document.getElementById('sliderFood').value) * COST_INDICES.food;
        const expMarket = parseFloat(document.getElementById('sliderMarket').value) * COST_INDICES.market;
        const expTrans = parseFloat(document.getElementById('sliderTransport').value) * COST_INDICES.trans;
        const expUtil = parseFloat(document.getElementById('sliderUtility').value) * COST_INDICES.util;
        const expFixed = parseFloat(document.getElementById('sliderFixed').value) * COST_INDICES.fixed;
        // Total Monthly Expense
        // Note: localRentCost is already calculated
        const totalMonthlyExpense = expFood + expMarket + expTrans + expUtil + expFixed + localRentCost;

        // KPI Update: Local Monthly Expense
        document.getElementById('totalCostKRW').textContent = Math.round(totalMonthlyExpense).toLocaleString();

        // Convert back to MYR for display
        const totalMonthlyMYR = totalMonthlyExpense * currentExchangeRate; // Fix: KRW * Rate = MYR
        document.getElementById('totalCostMYR').textContent = Math.round(totalMonthlyMYR).toLocaleString();

        // 6. Income
        const incomeSalaryMYR = parseNumber(document.getElementById('salaryMYR').value);
        const incomeSalaryKRW = incomeSalaryMYR * (1 / currentExchangeRate); // Fix: Divide by rate (MYR->KRW)

        // Investment Income (Calculated in Loop)
        const yieldRate = parseFloat(document.getElementById('sliderInterest').value) / 100;

        document.getElementById('totalIncomeDisplay').textContent = Math.round(incomeSalaryKRW).toLocaleString(); // Basic Income

        // 7. Simulation Loop
        // Extend horizon so users can see depletion timing beyond 50 years.
        // We still keep an upper bound to avoid unbounded loops.
        const simMonths = 12 * 50; // 50 Years
        const dataPoints = [];
        const labels = [];

        let simAsset = currentAsset;

        // Stress Logic
        let appliedYield = yieldRate;
        let appliedExRate = currentExchangeRate;

        if (stressYieldFlag) appliedYield = Math.max(0, yieldRate - 0.02); // -2%p
        if (stressRateFlag) appliedExRate = currentExchangeRate * 0.9; // -10% Value

        // Monthly Inflation
        const monthlyInflation = INFLATION_RATE / 12;
        // Monthly Yield
        const monthlyYield = appliedYield / 12;

        let depleteIndex = -1;

        // First-year cashflow diagnostics (monthly net flow)
        let firstYearSumNetFlow = 0;
        let firstYearMinNetFlow = Infinity;
        let firstYearCount = 0;

        for (let i = 0; i <= simMonths; i++) {
            // Add Data point (Yearly or every 6 months to reduce chart load?)
            // ChartJS can handle 600 points, but let's do monthly.

            if (i % 12 === 0) {
                labels.push((i / 12) + '년');
                dataPoints.push(Math.round(simAsset));
            }

            if (simAsset <= 0) {
                simAsset = 0;
                if (depleteIndex === -1 && i > 0) depleteIndex = i;
            }

            // a. Investment Return (After Tax 15.4%)
            let profit = simAsset * monthlyYield;
            let tax = profit * 0.154;
            let netProfit = profit - tax;

            // b. Income (Salary)
            // Salary is usually fixed or rises with inflation? Assumption: Fixed for simplified MVP or rises?
            // Let's assume Salary rises with inflation too for realism, OR fixed. MVP: Fixed.
            let monthlyIncome = incomeSalaryKRW;

            // c. Expense (Inflated)
            // Expense rises with inflation
            let currentMonthExpense = totalMonthlyExpense * Math.pow(1 + monthlyInflation, i);

            // Net Flow
            const monthNetFlow = netProfit + monthlyIncome - currentMonthExpense;
            simAsset = simAsset + monthNetFlow;

            if (i < 12) {
                firstYearSumNetFlow += monthNetFlow;
                firstYearMinNetFlow = Math.min(firstYearMinNetFlow, monthNetFlow);
                firstYearCount += 1;
            }
        }

        const isNotDepletedWithinHorizon = (depleteIndex === -1);

        // Update Chart
        updateChart(labels, dataPoints, isNotDepletedWithinHorizon);

        // Update Comparison & Breakdown
        updateComparisonChart(housingType, localRentCost);

        // True Cashflow (Income vs Expense)
        updateCashflowChart(totalMonthlyExpense, incomeSalaryKRW, appliedYield, currentAsset);

        // Prepare Objects for Breakdown
        const krwExpenses = {
            f: parseFloat(document.getElementById('sliderFood').value),
            m: parseFloat(document.getElementById('sliderMarket').value),
            t: parseFloat(document.getElementById('sliderTransport').value),
            u: parseFloat(document.getElementById('sliderUtility').value),
            x: parseFloat(document.getElementById('sliderFixed').value),
            r: parseFloat(document.getElementById('sliderRent').value) // Korea Rent
        };

        const localExpenses = {
            f: expFood,
            m: expMarket,
            t: expTrans,
            u: expUtil,
            x: expFixed,
            r: localRentCost // Local logic
        };

        updateBreakdown(krwExpenses, localExpenses, currentExchangeRate);

        // Derived Metrics for Report
        const finalMonths = isNotDepletedWithinHorizon ? simMonths : depleteIndex;
        const interestRateVal = parseFloat(document.getElementById('sliderInterest').value);

        // V7.2 Fix: Update Main Dashboard Runway Display
        const rDisplay = document.getElementById('runwayDisplay');
        if (rDisplay) {
            const rY = Math.floor(finalMonths / 12);
            const rM = finalMonths % 12;
            if (isNotDepletedWithinHorizon) {
                rDisplay.innerHTML = `${rY}년+ <span class='text-sm text-gray-500'>(시뮬레이션 범위 내 미고갈)</span>`;
            } else {
                rDisplay.innerHTML = `${rY}년 ${rM}개월 <span class='text-sm text-gray-500'>(현재 소비 기준)</span>`;
            }
        }

        // First-year cashflow stats
        const firstYearAvgNetFlow = firstYearCount > 0 ? (firstYearSumNetFlow / firstYearCount) : 0;
        const firstYearWorstNetFlow = Number.isFinite(firstYearMinNetFlow) ? firstYearMinNetFlow : 0;

        // Update Executive Report stats
        updateReport(
            isNotDepletedWithinHorizon,
            finalMonths,
            currentAsset,
            totalMonthlyExpense,
            incomeSalaryKRW,
            appliedYield,
            simGross,
            simTax,
            fxCost,
            firstYearAvgNetFlow,
            firstYearWorstNetFlow,
            simMonths,
            spread
        );

        // Visa Status (MM2H) - based on liquid assets proof (cash + stock)
        const liquidProof = (window.simStockGross || 0) + (window.simCashGross || 0);
        updateVisaStatus(liquidProof);

        saveToLocal();
    } catch (err) {
        console.error("Simulation Error:", err);
        alert("시뮬레이션 오류: " + err.message);
    }
}

// User Request 3 & 5: Split View Chart (Korea vs Malaysia)
function updateComparisonChart(housingType, localRentCost) {
    const ctx = document.getElementById('compareChart').getContext('2d');

    // Recalculate Korea Expenses (Inputs)
    const eFood = parseInt(document.getElementById('sliderFood').value) || 0;
    const eMarket = parseInt(document.getElementById('sliderMarket').value) || 0;
    const eTrans = parseInt(document.getElementById('sliderTransport').value) || 0;
    const eUtil = parseInt(document.getElementById('sliderUtility').value) || 0;
    const eFixed = parseInt(document.getElementById('sliderFixed').value) || 0;
    const eRent = parseInt(document.getElementById('sliderRent').value) || 0;

    // Korea Total
    // User Assumption: Inputs represent current Korea Spending.
    const koreaTotalExpense = eFood + eMarket + eTrans + eUtil + eFixed + eRent;

    // Malaysia Expenses (Calculated)
    const lFood = eFood * COST_INDICES.food;
    const lMarket = eMarket * COST_INDICES.market;
    const lTrans = eTrans * COST_INDICES.trans;
    const lUtil = eUtil * COST_INDICES.util;
    const lFixed = eFixed * COST_INDICES.fixed;
    // Rent is passed in (calculated in calculateAll based on Buy/Rent choice)

    const localTotalExpense = lFood + lMarket + lTrans + lUtil + lFixed + localRentCost;

    // Render Chart
    if (compareChart) compareChart.destroy();

    compareChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['한국 (KRW)', '말레이시아 (KRW 환산)'],
            datasets: [{
                data: [koreaTotalExpense, localTotalExpense],
                backgroundColor: ['#3b82f6', '#10b981'],
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

    // Savings Alert
    const savings = koreaTotalExpense - localTotalExpense;
    const alertBox = document.getElementById('savingsAlert');
    if (alertBox) {
        if (savings > 0) {
            alertBox.innerHTML = `🎉 월 <strong style="color:#10b981">${savings.toLocaleString()}원</strong> 절약 가능! (약 ${Math.round((savings / koreaTotalExpense) * 100)}% 절감)`;
            alertBox.style.display = 'block';
        } else {
            alertBox.style.display = 'none';
        }
    }
}

function updateCashflowChart(totalMonthlyExpense, incomeSalaryKRW, appliedYield, investableAssets) {
    const canvas = document.getElementById('cashflowChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Monthly net investment return (after 15.4% tax)
    const monthlyYield = (appliedYield || 0) / 12;
    const grossInvestmentReturn = (investableAssets || 0) * monthlyYield;
    const netInvestmentReturn = grossInvestmentReturn * (1 - 0.154);

    const totalIncome = (incomeSalaryKRW || 0) + netInvestmentReturn;
    const totalExpense = totalMonthlyExpense || 0;

    if (cashflowChart) cashflowChart.destroy();

    cashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['수익 (KRW)', '지출 (KRW)'],
            datasets: [{
                data: [Math.max(0, totalIncome), Math.max(0, totalExpense)],
                backgroundColor: ['#10b981', '#ef4444'],
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
}

function updateVisaStatus(liquidProofKRW) {
    const resultEl = document.getElementById('visaCheckResult');
    const badgeEl = document.getElementById('visaBadge');
    if (!resultEl || !badgeEl) return;

    const rate = (typeof currentExchangeRate === 'number' && currentExchangeRate > 0)
        ? currentExchangeRate
        : (1 / 300);

    const liquidKRW = Math.max(0, Number(liquidProofKRW) || 0);
    const liquidMYR = liquidKRW * rate;
    const myrRounded = Math.round(liquidMYR);

    // Simplified heuristic thresholds (liquid assets proof basis)
    const THRESH_OK_MYR = 1000000;
    const THRESH_MAYBE_MYR = 500000;

    let label = '부족';
    let color = '#ef4444';

    if (myrRounded >= THRESH_OK_MYR) {
        label = '충족 가능';
        color = '#10b981';
    } else if (myrRounded >= THRESH_MAYBE_MYR) {
        label = '검토 필요';
        color = 'var(--primary)';
    }

    badgeEl.textContent = `${label} · MYR ${myrRounded.toLocaleString()}`;
    badgeEl.style.color = color;
    resultEl.title = `유동자산 증빙(현금+주식): 약 ${Math.round(liquidKRW).toLocaleString()} KRW`;
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

function _simulateMetrics(startAsset, monthlyExpense, monthlyIncomeKRW, annualYield, horizonMonths) {
    const monthlyInflation = INFLATION_RATE / 12;
    const monthlyYield = Math.max(0, Number(annualYield) || 0) / 12;

    let simAsset = Math.max(0, Number(startAsset) || 0);
    let depleteIndex = -1;

    let firstYearSumNetFlow = 0;
    let firstYearMinNetFlow = Infinity;
    let firstYearCount = 0;

    for (let i = 0; i <= horizonMonths; i++) {
        if (simAsset <= 0) {
            simAsset = 0;
            if (depleteIndex === -1 && i > 0) depleteIndex = i;
        }

        const profit = simAsset * monthlyYield;
        const netProfit = profit * (1 - 0.154);
        const currentMonthExpense = monthlyExpense * Math.pow(1 + monthlyInflation, i);

        const monthNetFlow = netProfit + monthlyIncomeKRW - currentMonthExpense;
        simAsset += monthNetFlow;

        if (i < 12) {
            firstYearSumNetFlow += monthNetFlow;
            firstYearMinNetFlow = Math.min(firstYearMinNetFlow, monthNetFlow);
            firstYearCount += 1;
        }
    }

    const isNotDepletedWithinHorizon = (depleteIndex === -1);
    const finalMonths = isNotDepletedWithinHorizon ? horizonMonths : depleteIndex;
    const firstYearAvgNetFlow = firstYearCount > 0 ? (firstYearSumNetFlow / firstYearCount) : 0;
    const firstYearWorstNetFlow = Number.isFinite(firstYearMinNetFlow) ? firstYearMinNetFlow : 0;

    return { isNotDepletedWithinHorizon, finalMonths, firstYearAvgNetFlow, firstYearWorstNetFlow };
}

function _gradeKey(isNotDepletedWithinHorizon, totalMonths) {
    const years = Math.floor(totalMonths / 12);
    if (isNotDepletedWithinHorizon || years >= 30) return 'safe';
    if (years >= 15) return 'caution';
    return 'danger';
}

function _hashSeed() {
    let h = 2166136261;
    for (let i = 0; i < arguments.length; i++) {
        const n = Number(arguments[i]) || 0;
        const x = (Number.isFinite(n) ? Math.round(n) : 0) | 0;
        h ^= x;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _randn(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function _monteCarloSurvivalProbability(startAsset, monthlyExpense, monthlyIncomeKRW, annualYield, horizonMonths, opts) {
    const options = opts || {};
    const trials = Math.max(50, Math.min(1000, parseInt(options.trials || 300, 10) || 300));
    const annualVol = Math.max(0, Number(options.annualVol) || 0.12);
    const monthlyInflation = INFLATION_RATE / 12;
    const meanMonthly = (Math.max(0, Number(annualYield) || 0)) / 12;
    const sdMonthly = annualVol / Math.sqrt(12);

    const seed = _hashSeed(startAsset, monthlyExpense, monthlyIncomeKRW, annualYield * 1e6, horizonMonths, annualVol * 1e6);
    const rng = _mulberry32(seed);

    let survive = 0;
    for (let t = 0; t < trials; t++) {
        let asset = Math.max(0, Number(startAsset) || 0);
        for (let i = 0; i <= horizonMonths; i++) {
            if (asset <= 0) {
                asset = 0;
                break;
            }

            const z = _randn(rng);
            let monthlyReturn = meanMonthly + sdMonthly * z;
            monthlyReturn = Math.max(-0.95, monthlyReturn);

            const profit = asset * monthlyReturn;
            const netProfit = profit > 0 ? profit * (1 - 0.154) : profit;
            const currentMonthExpense = monthlyExpense * Math.pow(1 + monthlyInflation, i);

            asset += (netProfit + monthlyIncomeKRW - currentMonthExpense);
        }

        if (asset > 0) survive += 1;
    }

    return survive / trials;
}

function _monteCarloRuinProbabilityWithinMonths(startAsset, monthlyExpense, monthlyIncomeKRW, annualYield, ruinWithinMonths, opts) {
    const options = opts || {};
    const trials = Math.max(50, Math.min(1000, parseInt(options.trials || 300, 10) || 300));
    const annualVol = Math.max(0, Number(options.annualVol) || 0.12);
    const horizon = Math.max(1, parseInt(ruinWithinMonths || 0, 10) || 120);

    const monthlyInflation = INFLATION_RATE / 12;
    const meanMonthly = (Math.max(0, Number(annualYield) || 0)) / 12;
    const sdMonthly = annualVol / Math.sqrt(12);

    const seed = _hashSeed(startAsset, monthlyExpense, monthlyIncomeKRW, annualYield * 1e6, horizon, annualVol * 1e6, 101);
    const rng = _mulberry32(seed);

    let ruined = 0;
    for (let t = 0; t < trials; t++) {
        let asset = Math.max(0, Number(startAsset) || 0);
        let isRuined = false;

        for (let i = 0; i <= horizon; i++) {
            if (asset <= 0) {
                isRuined = true;
                break;
            }

            const z = _randn(rng);
            let monthlyReturn = meanMonthly + sdMonthly * z;
            monthlyReturn = Math.max(-0.95, monthlyReturn);

            const profit = asset * monthlyReturn;
            const netProfit = profit > 0 ? profit * (1 - 0.154) : profit;
            const currentMonthExpense = monthlyExpense * Math.pow(1 + monthlyInflation, i);

            asset += (netProfit + monthlyIncomeKRW - currentMonthExpense);
        }

        if (isRuined) ruined += 1;
    }

    return ruined / trials;
}

// V6.0 Report Logic
function updateReport(isNotDepletedWithinHorizon, totalMonths, netAssets, expense, income, appliedYield, grossAssets, taxCost, fxCost, firstYearAvgNetFlow, firstYearWorstNetFlow, horizonMonths, fxSpreadPct) {
    const years = Math.floor(totalMonths / 12);

    // 1. Metric: Liquidation loss (tax + FX)
    const lossEl = document.getElementById('reportLoss');
    const lossSubEl = document.getElementById('reportLossSub');
    if (lossEl) {
        const tCost = Math.max(0, Number(taxCost) || 0);
        const fCost = Math.max(0, Number(fxCost) || 0);
        const loss = tCost + fCost;
        lossEl.textContent = `약 ${Math.round(loss).toLocaleString()} 원`;

        if (lossSubEl) {
            const g = Math.max(0, Number(grossAssets) || 0);
            const lossRate = g > 0 ? (loss / g) * 100 : 0;
            const taxRate = g > 0 ? (tCost / g) * 100 : 0;
            const fxRate = g > 0 ? (fCost / g) * 100 : 0;
            lossSubEl.textContent = `헤어컷 ${lossRate.toFixed(1)}% (세금 ${taxRate.toFixed(1)}% + 환전 ${fxRate.toFixed(1)}%)`;
        }
    }

    // 2. Metric: Monthly net cashflow (income - expense)
    const cashflowEl = document.getElementById('reportCashflow');
    const cashflowSubEl = document.getElementById('reportCashflowSub');
    if (cashflowEl) {
        const avg = Number(firstYearAvgNetFlow) || 0;
        const worst = Number(firstYearWorstNetFlow) || 0;

        const sign = avg >= 0 ? '+' : '-';
        cashflowEl.textContent = `${sign} ${Math.round(Math.abs(avg)).toLocaleString()} 원/월`;

        if (cashflowSubEl) {
            const rate = (typeof currentExchangeRate === 'number' && currentExchangeRate > 0)
                ? currentExchangeRate
                : (1 / 300);

            const avgMYR = avg * rate;
            const worstMYR = worst * rate;

            cashflowSubEl.textContent = `첫해(12개월) 평균 · 최악월 ${Math.round(worst).toLocaleString()}원 (MYR ${Math.round(worstMYR).toLocaleString()})`;
        }
    }

    const gradeEl = document.getElementById('reportGrade');
    const gradeSub = document.getElementById('reportGradeSub');

    if (isNotDepletedWithinHorizon || years >= 30) {
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

    // Monte Carlo survival/ruin probability (deterministic seed; MVP-level assumption on volatility)
    try {
        const horizon = Math.max(12, parseInt(horizonMonths || 0, 10) || 12 * 50);
        const p = _monteCarloSurvivalProbability(netAssets, expense, income, appliedYield, horizon, { trials: 300, annualVol: 0.12 });
        const horizonY = Math.floor(horizon / 12);

        const ruinMonths = Math.min(120, horizon);
        const ruinY = Math.floor(ruinMonths / 12);
        const pr = _monteCarloRuinProbabilityWithinMonths(netAssets, expense, income, appliedYield, ruinMonths, { trials: 300, annualVol: 0.12 });

        if (gradeSub) gradeSub.textContent = `${gradeSub.textContent} · ${horizonY}년 생존확률 ${Math.round(p * 100)}% · ${ruinY}년 내 파산확률 ${Math.round(pr * 100)}% (MC 300회)`;
    } catch (e) {
        // no-op
    }

    // 3. Break-even Point logic (used in narrative/action plan)
    const interestRate = parseFloat(document.getElementById('sliderInterest').value) || 0;
    const realYield = Math.max(0, interestRate - 3.0);
    const passiveIncome = (netAssets * (realYield / 100)) / 12;
    let requiredIncome = expense - passiveIncome;
    if (requiredIncome < 0) requiredIncome = 0;

    // 3. Expert Text
    const expertEl = document.getElementById('expertComment');
    let expertText = "";

    if (isNotDepletedWithinHorizon) {
        expertText = `현재 설정 기준으로는 <strong>장기적으로 고갈되지 않는</strong> 구조입니다.\n물가 상승(3%)을 고려하더라도 자산 소득이 지출을 상회합니다.\n은퇴 후 여유로운 삶을 즐기거나, 현지 재투자/현금흐름 다변화를 고려해보세요.`;
    } else if (years >= 15) {
        expertText = `현재 자산 구조는 <strong>비교적 안정적</strong>이나, 인플레이션 영향으로 ${years}년 뒤 자산 감소가 가속화될 수 있습니다.\n초기 10년은 여유가 있지만, 60대 이후 의료비 등 변수에 대비하여 <strong>월 수익 ${Math.round(requiredIncome * 0.3 / 10000)}만원</strong> 정도의 소일거리를 만드는 것을 추천합니다.`;
    } else {
        expertText = `현재 구조로는 <strong>${years}년 내 자산 고갈</strong>이 예상됩니다.\n가장 시급한 것은 고정 지출을 줄이는 것입니다. 특히 주거비용(Rent) 비중이 높다면 매매 전환이나 저렴한 지역 이동을 고려해야 합니다.\n초기 정착금 사용을 최소화하고 즉각적인 현금 흐름 창출이 필요합니다.`;
    }

    if (stressRateFlag || stressYieldFlag) {
        expertText += `\n\n📌 <strong>스트레스 테스트 결과</strong>: 위기 상황 가정 시 자산 수명이 단축되었습니다. 비상 예비비를 자산의 10% 이상 확보하세요.`;
    }
    expertEl.innerHTML = expertText.replace(/\n/g, '<br>');

    // 4. Action Plan (Reverse Calc)
    const planList = document.getElementById('actionPlanList');
    planList.innerHTML = '';

    if (!isNotDepletedWithinHorizon && years < 30) {
        const save10 = expense * 0.1;
        const earn20 = expense * 0.2;

        planList.innerHTML += `<li>월 지출을 <strong>${Math.round(save10).toLocaleString()}원 (10%)</strong> 줄이면 수명이 약 5~8년 연장됩니다.</li>`;
        planList.innerHTML += `<li>현지에서 <strong>${Math.round(earn20).toLocaleString()}원</strong>의 추가 소득을 만들면 '주의' 등급으로 상향됩니다.</li>`;
        planList.innerHTML += `<li>보유 부동산/주식 중 수익률이 낮은 자산을 <strong>배당주(4~5%)</strong>로 리밸런싱 하세요.</li>`;
    } else {
        planList.innerHTML += `<li>현재 상태를 유지하며 <strong>건강 관리</strong>와 <strong>여가 생활</strong>에 집중하세요.</li>`;
        planList.innerHTML += `<li>상속세 및 증여 계획을 미리 수립하는 것이 좋습니다.</li>`;
    }

    // 5. Sensitivity (Top3) — append to Action Plan
    try {
        const horizon = Math.max(12, parseInt(horizonMonths || 0, 10) || 12 * 50);
        const baseFinalMonths = Math.max(0, parseInt(totalMonths || 0, 10) || 0);
        const baseGrade = _gradeKey(isNotDepletedWithinHorizon, baseFinalMonths);
        const baseWorst = Number(firstYearWorstNetFlow) || 0;

        const baseStartAsset = Math.max(0, Number(netAssets) || 0);
        const baseExpense = Math.max(0, Number(expense) || 0);
        const baseIncome = Number(income) || 0;
        const baseYield = Math.max(0, Number(appliedYield) || 0);

        const scenarios = [
            {
                name: '수익률 -1%p',
                startAsset: baseStartAsset,
                expense: baseExpense,
                income: baseIncome,
                yield: Math.max(0, baseYield - 0.01)
            },
            {
                name: '지출 +10%',
                startAsset: baseStartAsset,
                expense: baseExpense * 1.10,
                income: baseIncome,
                yield: baseYield
            },
            {
                name: '환전스프레드 +0.5%p',
                startAsset: Math.max(0, baseStartAsset - (Math.max(0, Number(grossAssets) || 0) - Math.max(0, Number(taxCost) || 0)) * 0.005),
                expense: baseExpense,
                income: baseIncome,
                yield: baseYield
            }
        ];

        const results = scenarios.map(s => {
            const r = _simulateMetrics(s.startAsset, s.expense, s.income, s.yield, horizon);
            const grade = _gradeKey(r.isNotDepletedWithinHorizon, r.finalMonths);
            return {
                name: s.name,
                isNotDepletedWithinHorizon: r.isNotDepletedWithinHorizon,
                finalMonths: r.finalMonths,
                grade,
                worst: r.firstYearWorstNetFlow,
                deltaMonths: r.finalMonths - baseFinalMonths,
                deltaWorst: (r.firstYearWorstNetFlow || 0) - baseWorst
            };
        });

        results.sort((a, b) => (a.deltaMonths - b.deltaMonths) || (a.deltaWorst - b.deltaWorst));

        const gradeLabel = (k) => (k === 'safe' ? '안전' : (k === 'caution' ? '주의' : '위험'));
        const fmtRunway = (isNot, m) => {
            if (isNot) return `${Math.floor(horizon / 12)}년+`;
            const y = Math.floor(m / 12);
            const mm = Math.max(0, m % 12);
            return `${y}년 ${mm}개월`;
        };
        const fmtSignedKRW = (v) => `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v)).toLocaleString()}원`;
        const fmtDeltaKRW = (v) => `${v >= 0 ? '+' : '-'}${Math.round(Math.abs(v)).toLocaleString()}원`;
        const fmtSignedPct = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;

        const baseRunway = fmtRunway(isNotDepletedWithinHorizon, baseFinalMonths);
        const baseWorstFmt = fmtSignedKRW(baseWorst);

        const top = results[0];
        const topPct = baseExpense > 0 ? (top.deltaWorst / baseExpense) * 100 : null;
        const topPctText = (topPct === null) ? '' : ` (월지출 대비 ${fmtSignedPct(topPct)})`;
        planList.innerHTML += `<li><strong>민감도(요약)</strong>: <span class='text-gray-500'>(가정이 바뀔 때 결과가 얼마나 흔들리는지)</span> 등급/수명(${baseRunway})은 유지되지만, <strong>최악월 여유(현금흐름 버퍼)</strong>는 <strong>${top.name}</strong>에서 ${fmtDeltaKRW(top.deltaWorst)}${topPctText} 변화로 가장 민감합니다.</li>`;
    } catch (e) {
        // no-op
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
            pRent: document.getElementById('propRentEst').value, // New V7.1
            pDep: document.getElementById('propDepositEst').value, // New V7.1
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
            document.getElementById('propRentEst').value = d.modal.pRent || 0; // New V7.1
            document.getElementById('propDepositEst').value = d.modal.pDep || 0; // New V7.1
            document.getElementById('propYears').value = d.modal.pYears || 2;
            document.getElementById('propOneHouse').checked = d.modal.pOne;
            document.getElementById('stockSell').value = d.modal.sSell || 0;
            document.getElementById('stockBuy').value = d.modal.sBuy || 0;
            document.getElementById('stockOverseas').checked = d.modal.sOver;
            document.getElementById('cashAmount').value = d.modal.cash || 0;
            document.getElementById('fxSpread').value = d.modal.fx || 1.0;
            document.getElementById('fxSpreadVal').textContent = (d.modal.fx || 1.0) + '%';
            updateTaxModal();
        }
    }
    // Ensure simulation runs after loading data
    calculateAll();
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


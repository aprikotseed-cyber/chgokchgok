// Chart.js(전역 Chart)로 그리는 꺾은선그래프. 색은 CSS 변수에서 읽어 라이트/다크 모드를 따릅니다.
import { won, wonShort, ymLabel } from './format.js?v=20261109w';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const charts = new Map();

function base() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4, right: 8 } },
    elements: {
      line: { borderWidth: 2, tension: 0.25 },
      point: { radius: 0, hoverRadius: 5, hitRadius: 12, hoverBorderWidth: 2, hoverBorderColor: css('--surface-1') },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css('--border') }, ticks: { color: css('--text-muted'), maxRotation: 0, autoSkipPadding: 12 } },
      y: {
        grid: { color: css('--grid') }, border: { display: false },
        ticks: {
          color: css('--text-muted'), maxTicksLimit: 6,
          // 눈금 간격이 좁으면 소수 자리를 늘려서 '7.4억'이 여러 번 나오지 않게
          callback: (v, i, ticks) => {
            const step = ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 1e8;
            if (Math.abs(v) < 1e8 || step >= 1e8) return wonShort(v);
            const digits = Math.min(4, Math.max(1, Math.ceil(-Math.log10(step / 1e8))));
            return `${(v / 1e8).toFixed(digits)}억`;
          },
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface-3'), titleColor: css('--text-primary'), bodyColor: css('--text-secondary'),
        borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: (c) => ` ${c.dataset.label}  ${won(c.parsed.y)}` },
      },
    },
  };
}

// 마우스/손가락 위치에 세로 안내선
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const a = chart.tooltip?.getActiveElements?.();
    if (!a?.length) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = css('--border');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a[0].element.x, chartArea.top);
    ctx.lineTo(a[0].element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function draw(canvas, config) {
  if (!window.Chart || !canvas) return;
  charts.get(canvas.id)?.destroy();
  charts.set(canvas.id, new window.Chart(canvas, { ...config, plugins: [crosshair] }));
}

export function projectionChart(canvas, points) {
  const series = [
    ['저축액', (p) => p.savings + p.stocks, '--series-1'],
    ['대출잔액', (p) => p.debts, '--series-2'],
    ['총자산', (p) => p.net, '--series-3'],
  ];
  draw(canvas, {
    type: 'line',
    data: {
      labels: points.map((p) => (p.label === '현재' ? '현재' : `${p.year}`)),
      datasets: series.map(([label, get, color]) => ({
        label, data: points.map(get),
        borderColor: css(color), backgroundColor: css(color), pointBackgroundColor: css(color),
      })),
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        tooltip: { ...base().plugins.tooltip, callbacks: { ...base().plugins.tooltip.callbacks, title: (c) => (c[0].label === '현재' ? '지금' : `${c[0].label}년 말`) } },
      },
    },
  });
}

/** 자산 추이: 총자산 한 줄. 손을 대면 그날의 저축액·주택·대출잔액도 */
export function trendChart(canvas, points, mode = 'day') {
  const prevWord = { day: '전일', month: '전월', year: '전년' }[mode];
  const sgn = (v) => `${v >= 0 ? '+' : '−'}${won(Math.abs(v))}`;
  const color = css('--series-3');
  draw(canvas, {
    type: 'line',
    data: {
      labels: points.map((p) => p.label),
      datasets: [{
        label: '총자산', data: points.map((p) => p.net),
        borderColor: color, backgroundColor: `${color}1a`, pointBackgroundColor: color,
        pointRadius: points.length <= 14 ? 3 : 0, pointBorderColor: css('--surface-1'), pointBorderWidth: 2, tension: 0.2,
        fill: 'start', // 아래를 옅게 채워 증가 흐름이 잘 보이게
      }],
    },
    options: {
      ...base(),
      scales: { ...base().scales, y: { ...base().scales.y, grace: '5%' } },
      plugins: {
        ...base().plugins,
        tooltip: {
          ...base().plugins.tooltip,
          callbacks: {
            label: (c) => ` 총자산  ${won(c.parsed.y)}`,
            afterBody: (c) => {
              const p = points[c[0].dataIndex];
              const lines = [];
              // 그 기간에 얼마나 움직였고, 무엇 때문인지
              if (p.diff) {
                lines.push(`${prevWord} 대비 ${sgn(p.diff.net)}`);
                for (const [k, v] of [['  주식(환율 포함)', p.diff.stocks], ['  저축·현금', p.diff.cash], ['  주택', p.diff.homes], ['  대출잔액', p.diff.debts]]) if (v) lines.push(`${k} ${sgn(v)}`);
              }
              if (p.savings != null) lines.push('', `저축액 ${won(p.savings)}`, `주택 ${won(p.homes)}`, `대출잔액 ${won(p.debts)}`);
              return lines;
            },
          },
        },
      },
    },
  });
}

export function homeChart(canvas, monthly) {
  draw(canvas, {
    type: 'line',
    data: {
      labels: monthly.map((m) => m.ym.slice(2).replace('-', '.')),
      datasets: [{
        label: '월별 실거래 중앙값', data: monthly.map((m) => m.median), spanGaps: true,
        borderColor: css('--series-1'), backgroundColor: css('--series-1'), pointBackgroundColor: css('--series-1'),
        pointRadius: 3, pointBorderColor: css('--surface-1'), pointBorderWidth: 2,
      }],
    },
    options: {
      ...base(),
      plugins: {
        ...base().plugins,
        tooltip: {
          ...base().plugins.tooltip,
          callbacks: {
            title: (c) => ymLabel(monthly[c[0].dataIndex].ym),
            label: (c) => ` 중앙값 ${won(c.parsed.y)} (${monthly[c.dataIndex].count}건)`,
          },
        },
      },
    },
  });
}

export function redrawAll() {
  // 다크/라이트 전환 시 색을 다시 읽어야 해서, 화면 쪽에서 다시 그리도록 신호만 줍니다.
  charts.forEach((c) => c.destroy());
  charts.clear();
}

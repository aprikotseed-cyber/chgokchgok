// Chart.js(전역 Chart)로 그리는 꺾은선그래프. 색은 CSS 변수에서 읽어 라이트/다크 모드를 따릅니다.
import { won, wonShort, ymLabel } from './format.js?v=20261109g';

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
        ticks: { color: css('--text-muted'), callback: (v) => wonShort(v), maxTicksLimit: 6 },
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

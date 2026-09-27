'use client';

import React from 'react';

interface TrustScoreGaugeProps {
  score: number; // 0 to 100
  size?: number; // width/height in px
}

export default function TrustScoreGauge({ score, size = 180 }: TrustScoreGaugeProps) {
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let color = '#16a34a'; // green
  if (score < 50) color = '#dc2626'; // red
  else if (score < 75) color = '#d97706'; // amber

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold text-[#1a1a1a] tracking-tight">{score}</span>
        <span className="text-xs font-semibold text-gray-500">/ 100</span>
      </div>
    </div>
  );
}

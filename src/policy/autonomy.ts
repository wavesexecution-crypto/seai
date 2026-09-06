import { config } from '../config.js';

export type AutonomyLevel = 'OBSERVE' | 'ASSIST' | 'EXECUTE_SAFE' | 'AUTONOMOUS';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const RANK: Record<AutonomyLevel, number> = { OBSERVE: 0, ASSIST: 1, EXECUTE_SAFE: 2, AUTONOMOUS: 3 };

export interface PolicyVerdict {
  allowed: boolean;
  decision: 'allow' | 'require_confirmation' | 'deny';
  reason: string;
  autonomyLevel: AutonomyLevel;
}

/**
 * Policy engine — sits between the model and Shopify. The model can NEVER
 * call Shopify directly; every tool request passes through evaluate().
 */
export function evaluatePolicy(tool: string, risk: RiskLevel, opts: { reversible?: boolean; confirmed?: boolean; autonomyLevel?: AutonomyLevel } = {}): PolicyVerdict {
  const level = opts.autonomyLevel ?? config.autonomyLevel;
  const reversible = opts.reversible ?? true;
  const confirmed = opts.confirmed ?? false;

  // Read-only tools always allowed (observation is the base of autonomy)
  if (risk === 'low') return { allowed: true, decision: 'allow', reason: `${tool}: low-risk read/safe action allowed at ${level}`, autonomyLevel: level };

  if (level === 'OBSERVE') {
    return { allowed: false, decision: 'deny', reason: `${tool}: OBSERVE mode blocks all writes`, autonomyLevel: level };
  }
  if (level === 'ASSIST') {
    if (confirmed) return { allowed: true, decision: 'allow', reason: `${tool}: explicit user confirmation`, autonomyLevel: level };
    return { allowed: false, decision: 'require_confirmation', reason: `${tool}: ASSIST mode requires confirmation`, autonomyLevel: level };
  }
  if (level === 'EXECUTE_SAFE') {
    if (risk === 'medium' && reversible) return { allowed: true, decision: 'allow', reason: `${tool}: safe reversible action auto-approved`, autonomyLevel: level };
    if (confirmed) return { allowed: true, decision: 'allow', reason: `${tool}: confirmed by user`, autonomyLevel: level };
    return { allowed: false, decision: 'require_confirmation', reason: `${tool}: risk=${risk} requires confirmation at EXECUTE_SAFE`, autonomyLevel: level };
  }
  // AUTONOMOUS: allow reversible; irreversible critical still needs confirmation
  if (risk === 'critical' && !reversible && !confirmed) {
    return { allowed: false, decision: 'require_confirmation', reason: `${tool}: irreversible critical action needs confirmation even in AUTONOMOUS`, autonomyLevel: level };
  }
  return { allowed: true, decision: 'allow', reason: `${tool}: AUTONOMOUS allows risk=${risk}`, autonomyLevel: level };
}

export function isHighRiskArgs(tool: string, args: Record<string, any>): { risk: RiskLevel; why: string } {
  // Escalate risk based on magnitude (large discounts, price changes, deletes)
  if (/delete|archive|deactivate|disable/i.test(tool)) return { risk: 'high', why: 'destructive/irreversible-leaning operation' };
  if (tool === 'discounts.create' && Number(args?.percent ?? 0) >= 30) return { risk: 'high', why: `large discount ${args.percent}%` };
  if (tool === 'products.update' && args?.price !== undefined) return { risk: 'high', why: 'price change is financially consequential' };
  if (tool === 'inventory.update' && Math.abs(Number(args?.availableDelta ?? 0)) > 100) return { risk: 'high', why: 'large inventory adjustment' };
  if (/theme/i.test(tool)) return { risk: 'critical', why: 'storefront theme change' };
  return { risk: 'medium', why: 'standard write' };
}

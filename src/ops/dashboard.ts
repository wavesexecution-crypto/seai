import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { requireAuth } from '../auth/middleware.js';

export const opsDashboardRouter = Router();

// GET /api/ops/dashboard — key business metrics from real records
opsDashboardRouter.get('/', requireAuth, async (_req: Request, res: Response) => {
  const [
    leads, proposals, clients, projects, invoices, users,
  ] = await Promise.all([
    db.list('leads', {}, 5000),
    db.list('proposals', {}, 5000),
    db.list('clients', {}, 5000),
    db.list('projects', {}, 5000),
    db.list('invoices', {}, 5000),
    db.list('users', {}, 5000),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[String(l.stage)] = (byStage[String(l.stage)] ?? 0) + 1;
  const won = byStage['won'] ?? 0;
  const lost = byStage['lost'] ?? 0;
  const closed = won + lost;

  const proposalsByStatus: Record<string, number> = {};
  for (const p of proposals) proposalsByStatus[String(p.status)] = (proposalsByStatus[String(p.status)] ?? 0) + 1;

  // MRR comes from active service agreements (monthly_fee_inr lives on agreements, not clients)
  const agreements = await db.list('service_agreements', { status: 'active' }, 5000);
  const recurringRevenue = agreements.reduce((s, a) => s + Number(a.monthly_fee_inr ?? 0), 0);

  const totalRevenue = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + Number(i.total_inr ?? 0), 0);

  const outstanding = invoices
    .filter((i) => ['sent', 'overdue'].includes(String(i.status)))
    .reduce((s, i) => s + Number(i.total_inr ?? 0), 0);

  const upcomingDeadlines = projects
    .filter((p) => p.due_date && !['completed', 'cancelled'].includes(String(p.status)))
    .map((p) => ({ id: p.id, name: p.name, client_id: p.client_id, due_date: p.due_date, status: p.status }))
    .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 10);

  const recentActivity = leads
    .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 10)
    .map((l) => ({ id: l.id, type: 'lead', title: l.business_name, status: l.stage, updated_at: l.updated_at }));

  res.json({
    ok: true,
    metrics: {
      total_leads: leads.length,
      new_leads_today: leads.filter((l) => String(l.created_at).slice(0, 10) === today).length,
      new_leads_7d: leads.filter((l) => String(l.created_at) >= weekAgo).length,
      qualified_leads: byStage['qualified'] ?? 0,
      active_prospects: (byStage['contacted'] ?? 0) + (byStage['responded'] ?? 0) + (byStage['negotiation'] ?? 0),
      pending_proposals: (proposalsByStatus['draft'] ?? 0) + (proposalsByStatus['sent'] ?? 0) + (proposalsByStatus['viewed'] ?? 0),
      won_deals: won,
      lost_deals: lost,
      active_clients: clients.filter((c) => c.status === 'active').length,
      onboarding_clients: clients.filter((c) => c.status === 'onboarding').length,
      active_projects: projects.filter((p) => p.status === 'active').length,
      completed_projects: projects.filter((p) => p.status === 'completed').length,
      monthly_recurring_revenue: recurringRevenue,
      total_revenue: totalRevenue,
      outstanding_payments: outstanding,
      conversion_rate: closed ? Math.round((won / closed) * 100) : null,
      total_staff: users.length,
      follow_up_due: leads.filter((l) => l.next_follow_up_at && String(l.next_follow_up_at).slice(0, 10) <= today && !['won', 'lost'].includes(String(l.stage))).length,
    },
    upcoming_deadlines: upcomingDeadlines,
    recent_activity: recentActivity,
    proposals_by_status: proposalsByStatus,
    leads_by_stage: byStage,
  });
});

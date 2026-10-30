import { ActionForm } from '@/components/forms/action-form';
import { LinkResultForm } from '@/components/forms/link-result-form';
import { Alert, Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui';
import { assignableRoles } from '@/lib/permissions';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { inviteStaffAction, revokeInvitationAction, staffResetLinkAction, updateMemberAction } from './actions';

const ROLE_LABEL: Record<string, string> = {
  RESTAURANT_OWNER: 'Owner',
  RESTAURANT_MANAGER: 'Manager',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen staff',
  CAFE_STAFF: 'Café staff',
  DELIVERY_STAFF: 'Delivery staff',
};

const ROLE_HELP: Record<string, string> = {
  RESTAURANT_OWNER: 'Everything, including subscription.',
  RESTAURANT_MANAGER: 'Everything except subscription billing.',
  WAITER: 'Orders, table requests, payments, reservations.',
  KITCHEN_STAFF: 'Kitchen display and sold-out switches only.',
  CAFE_STAFF: 'Café display, orders view and table requests.',
  DELIVERY_STAFF: 'Only their delivery list.',
};

export default async function StaffPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'staff.manage');
  const [members, invitations, locations] = await Promise.all([
    db.restaurantMembership.findMany({ where: { organizationId: ctx.org.id }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    db.invitation.findMany({ where: { organizationId: ctx.org.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    accessibleLocations(ctx),
  ]);
  const roles = assignableRoles(ctx.role);
  return (
    <>
      <PageHeader title="Staff" description="Each person signs in with their own account. What they can see is limited by their role and checked on the server." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title={`Team (${members.length})`} />
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const editable = roles.includes(m.role) && m.userId !== ctx.userId;
              return (
                <li key={m.id} className="px-5 py-4" data-testid="staff-member">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{m.user.name} {m.userId === ctx.userId && <span className="text-xs text-muted">(you)</span>}</p>
                      <p className="text-xs text-muted">{m.user.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge tone="dark">{ROLE_LABEL[m.role]}</Badge>
                      {m.status !== 'ACTIVE' && <Badge tone="danger">{m.status}</Badge>}
                    </div>
                  </div>
                  {editable && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted">Edit access</summary>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <ActionForm action={updateMemberAction} submitLabel="Save" submitVariant="secondary">
                          <input type="hidden" name="org" value={ctx.org.slug} />
                          <input type="hidden" name="membershipId" value={m.id} />
                          <Field label="Role" htmlFor={`role-${m.id}`}>
                            <Select id={`role-${m.id}`} name="role" defaultValue={m.role}>
                              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                            </Select>
                          </Field>
                          <Field label="Status" htmlFor={`status-${m.id}`}>
                            <Select id={`status-${m.id}`} name="status" defaultValue={m.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE'}>
                              <option value="ACTIVE">Active</option>
                              <option value="DISABLED">Disabled (no access)</option>
                            </Select>
                          </Field>
                          {locations.length > 1 && (
                            <Field label="Locations" htmlFor={`loc-${m.id}`} hint="None selected = all locations">
                              <Select id={`loc-${m.id}`} name="locationIds" multiple defaultValue={m.locationIds}>
                                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </Select>
                            </Field>
                          )}
                        </ActionForm>
                        {!env.SMTP_URL && (
                          <LinkResultForm action={staffResetLinkAction} submitLabel="Create password reset link" note="Give this single-use link (30 min) to the staff member:">
                            <input type="hidden" name="org" value={ctx.org.slug} />
                            <input type="hidden" name="membershipId" value={m.id} />
                          </LinkResultForm>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Invite someone" description={env.SMTP_URL ? 'An invitation email will be sent.' : 'Email is not configured: copy the link and send it yourself (WhatsApp, SMS…).'} />
            <CardBody>
              <LinkResultForm action={inviteStaffAction} submitLabel="Create invitation" note="Invitation link (valid 7 days):" testId="invite-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <Field label="Email" htmlFor="invite-email"><Input id="invite-email" name="email" type="email" required /></Field>
                <Field label="Role" htmlFor="invite-role">
                  <Select id="invite-role" name="role" defaultValue="WAITER">
                    {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HELP[r]}</option>)}
                  </Select>
                </Field>
                {locations.length > 1 && (
                  <Field label="Locations" htmlFor="invite-loc" hint="None selected = all locations">
                    <Select id="invite-loc" name="locationIds" multiple>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </Field>
                )}
              </LinkResultForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Pending invitations" />
            {invitations.length === 0 ? (
              <CardBody className="text-sm text-muted">None.</CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      {i.email}
                      <span className="block text-xs text-muted">{ROLE_LABEL[i.role]} · expires {i.expiresAt.toISOString().slice(0, 10)}</span>
                    </span>
                    <ActionForm action={revokeInvitationAction} submitLabel="Revoke" submitVariant="secondary" className="space-y-0">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="invitationId" value={i.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Alert tone="info">Staff accounts are personal. Never share one login between several people.</Alert>
        </div>
      </div>
    </>
  );
}

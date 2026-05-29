import React, { useEffect, useMemo, useRef, useState } from 'react';
import Select from 'react-select';
import { adminAPI, hierarchyAPI } from '../api';
import {
  AdminSummary,
  DropdownOption,
  RegistrationInvite,
  RequisitionElementOption,
  User,
  UserRole,
} from '../types';

type AdminTab = 'overview' | 'access' | 'dropdowns' | 'reference';
type DropdownCategory = 'concrete_grade' | 'placement_by' | 'vehicle_number' | 'difference_reason';
type ReferenceSortField = 'location' | 'structure_type' | 'structure_name' | 'structure_id' | 'element_id';
const emptyReferenceFilters: Record<ReferenceSortField, string> = {
  location: '',
  structure_type: '',
  structure_name: '',
  structure_id: '',
  element_id: '',
};

const categoryLabels: Record<DropdownCategory, string> = {
  concrete_grade: 'Concrete Grade',
  placement_by: 'Placement By',
  vehicle_number: 'Vehicle Number',
  difference_reason: 'Reason for Difference',
};

const emptySummary: AdminSummary = {
  users: 0,
  allowed_emails: 0,
  active_allowed_emails: 0,
  dropdown_options: 0,
  reference_rows: 0,
  pending_requisitions: 0,
  approved_requisitions: 0,
  dispatches_pending_acknowledgement: 0,
  dispatches_pending_return: 0,
  planning_decisions: 0,
};

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15';
const primaryButtonClass =
  'rounded-md bg-[#134377] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#134377] disabled:bg-gray-400';
const secondaryButtonClass =
  'rounded-md border border-[#134377] px-4 py-2 text-sm font-semibold text-[#134377] hover:bg-[#134377]/10 disabled:border-gray-300 disabled:text-gray-400';
const dangerButtonClass =
  'rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-400';
const tableHeaderClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]';
type SelectOption = { value: string; label: string };

const toOptions = (values: string[]): SelectOption[] =>
  Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }));

const selectClassNames = {
  control: (state: any) =>
    `min-h-[38px] rounded-md border bg-white text-sm shadow-sm ${
      state.isFocused ? 'border-[#134377] ring-2 ring-[#134377]/15' : 'border-gray-300'
    }`,
  valueContainer: () => 'px-2',
  input: () => 'text-sm text-gray-900',
  placeholder: () => 'text-sm text-gray-400',
  multiValue: () => 'rounded bg-[#134377]/10',
  multiValueLabel: () => 'text-xs text-[#134377]',
  menu: () => 'z-50 rounded-md border border-gray-200 bg-white text-sm shadow-lg',
  option: (state: any) =>
    `cursor-pointer px-3 py-2 ${
      state.isSelected ? 'bg-[#134377] text-white' : state.isFocused ? 'bg-[#134377]/10 text-gray-900' : 'text-gray-900'
    }`,
};

const getErrorMessage = (error: any, fallback: string) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join(', ');
  }
  return fallback;
};

const parseLocationList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const formatLocationList = (locations?: string[]) => (locations || []).join(', ');

const AdminView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [summary, setSummary] = useState<AdminSummary>(emptySummary);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [dropdowns, setDropdowns] = useState<DropdownOption[]>([]);
  const [referenceRows, setReferenceRows] = useState<RequisitionElementOption[]>([]);
  const [accessSearch, setAccessSearch] = useState('');
  const [dropdownSearch, setDropdownSearch] = useState('');
  const [referenceSearch, setReferenceSearch] = useState('');
  const referenceSearchRef = useRef('');
  const referenceFiltersRef = useRef<Record<ReferenceSortField, string>>(emptyReferenceFilters);
  const [referenceFilters, setReferenceFilters] = useState<Record<ReferenceSortField, string>>(emptyReferenceFilters);
  const [referenceSort, setReferenceSort] = useState<{ field: ReferenceSortField; direction: 'asc' | 'desc' }>({
    field: 'location',
    direction: 'asc',
  });
  const [allReferenceFilterOptions, setAllReferenceFilterOptions] = useState<Record<ReferenceSortField, SelectOption[]>>({
    location: [],
    structure_type: [],
    structure_name: [],
    structure_id: [],
    element_id: [],
  });
  const [dropdownCategory, setDropdownCategory] = useState<DropdownCategory>('concrete_grade');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingInviteId, setEditingInviteId] = useState<string | null>(null);
  const [editingDropdownId, setEditingDropdownId] = useState<string | null>(null);
  const [editingReferenceId, setEditingReferenceId] = useState<number | null>(null);
  const [locationDrafts, setLocationDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceHasSearched, setReferenceHasSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [locationOptions, setLocationOptions] = useState<SelectOption[]>([]);

  const [inviteForm, setInviteForm] = useState({
    email: '',
    name_hint: '',
    role: UserRole.EXECUTION,
    assigned_locations: '',
    is_active: true,
  });
  const [dropdownForm, setDropdownForm] = useState({
    value: '',
    label: '',
    sort_order: 0,
    is_active: true,
  });
  const [referenceForm, setReferenceForm] = useState<Omit<RequisitionElementOption, 'id'>>({
    location: '',
    structure_type: '',
    structure_name: '',
    structure_id: '',
    element_id: '',
  });

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [summaryData, usersData, inviteData, dropdownData, locations, referenceOptionData] = await Promise.all([
        adminAPI.getSummary(),
        adminAPI.getUsers(accessSearch),
        adminAPI.getRegistrationEmails(accessSearch),
        adminAPI.getDropdownOptions(dropdownCategory, dropdownSearch),
        hierarchyAPI.getLocations(),
        Promise.all([
          hierarchyAPI.getFilterOptions('location'),
          hierarchyAPI.getFilterOptions('structure_type'),
          hierarchyAPI.getFilterOptions('structure_name'),
          hierarchyAPI.getFilterOptions('structure_id'),
          hierarchyAPI.getFilterOptions('pile_lift_id'),
        ]),
      ]);
      setSummary(summaryData);
      setUsers(usersData);
      setLocationDrafts(Object.fromEntries(usersData.map((user) => [user.id, formatLocationList(user.assigned_locations)])));
      setInvites(inviteData);
      setDropdowns(dropdownData);
      setLocationOptions(toOptions(locations));
      setAllReferenceFilterOptions({
        location: toOptions(referenceOptionData[0]),
        structure_type: toOptions(referenceOptionData[1]),
        structure_name: toOptions(referenceOptionData[2]),
        structure_id: toOptions(referenceOptionData[3]),
        element_id: toOptions(referenceOptionData[4]),
      });
    } catch (error) {
      console.error('Failed to load admin data:', error);
      setMessage({ type: 'error', text: 'Failed to load admin data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      adminAPI.getUsers(accessSearch).then((nextUsers) => {
        setUsers(nextUsers);
        setLocationDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, formatLocationList(user.assigned_locations)])));
      }).catch(() => undefined);
      adminAPI.getRegistrationEmails(accessSearch).then(setInvites).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [accessSearch]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      adminAPI.getDropdownOptions(dropdownCategory, dropdownSearch).then(setDropdowns).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [dropdownCategory, dropdownSearch]);

  const registeredEmailSet = useMemo(
    () => new Set(users.map((user) => user.email.toLowerCase())),
    [users]
  );

  const selectedLocationOptions = (value: string) => toOptions(parseLocationList(value));

  const filteredReferenceRows = useMemo(() => {
    return [...referenceRows]
      .filter((row) =>
        (Object.entries(referenceFilters) as Array<[ReferenceSortField, string]>).every(([field, value]) =>
          !value || String(row[field] || '') === value
        )
      )
      .sort((a, b) => {
        const left = String(a[referenceSort.field] || '');
        const right = String(b[referenceSort.field] || '');
        const comparison = left.localeCompare(right, undefined, { numeric: true });
        return referenceSort.direction === 'asc' ? comparison : -comparison;
      });
  }, [referenceFilters, referenceRows, referenceSort]);

  const searchReferenceRows = async (options: { quiet?: boolean } = {}) => {
    setReferenceLoading(true);
    if (!options.quiet) setMessage(null);
    try {
      const activeSearch = referenceSearchRef.current;
      const activeFilters = referenceFiltersRef.current;
      const rows = await adminAPI.getReferenceElements(activeSearch, activeFilters);
      setReferenceRows(rows);
      setReferenceHasSearched(true);
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to search reference data.') });
    } finally {
      setReferenceLoading(false);
    }
  };

  const clearReferenceSearch = () => {
    referenceSearchRef.current = '';
    referenceFiltersRef.current = emptyReferenceFilters;
    setReferenceSearch('');
    setReferenceFilters(emptyReferenceFilters);
    setReferenceRows([]);
    setReferenceHasSearched(false);
  };

  const resetInviteForm = () => {
    setEditingInviteId(null);
    setInviteForm({ email: '', name_hint: '', role: UserRole.EXECUTION, assigned_locations: '', is_active: true });
  };

  const saveInvite = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (editingInviteId) {
        await adminAPI.updateRegistrationEmail(editingInviteId, {
          name_hint: inviteForm.name_hint || undefined,
          role: inviteForm.role,
          assigned_locations: parseLocationList(inviteForm.assigned_locations),
          is_active: inviteForm.is_active,
        });
        setMessage({ type: 'success', text: 'Registration email updated.' });
      } else {
        await adminAPI.createRegistrationEmail({
          email: inviteForm.email,
          name_hint: inviteForm.name_hint || undefined,
          role: inviteForm.role,
          assigned_locations: parseLocationList(inviteForm.assigned_locations),
          is_active: inviteForm.is_active,
        });
        setMessage({ type: 'success', text: 'Registration email added.' });
      }
      resetInviteForm();
      await loadAdminData();
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to save registration email.') });
    } finally {
      setSaving(false);
    }
  };

  const editInvite = (invite: RegistrationInvite) => {
    setEditingInviteId(invite.invite_id);
    setInviteForm({
      email: invite.email,
      name_hint: invite.name_hint || '',
      role: invite.role,
      assigned_locations: formatLocationList(invite.assigned_locations),
      is_active: invite.is_active,
    });
  };

  const updateUserRole = async (user: User, role: UserRole) => {
    setEditingUserId(user.id);
    setMessage(null);
    try {
      await adminAPI.updateUser(user.id, { role });
      setMessage({ type: 'success', text: `${user.name} is now ${role}.` });
      await loadAdminData();
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to update user role.') });
    } finally {
      setEditingUserId(null);
    }
  };

  const updateUserLocations = async (user: User) => {
    setEditingUserId(user.id);
    setMessage(null);
    try {
      await adminAPI.updateUser(user.id, {
        assigned_locations: parseLocationList(locationDrafts[user.id] || ''),
      });
      setMessage({ type: 'success', text: `${user.name}'s locations updated.` });
      await loadAdminData();
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to update user locations.') });
    } finally {
      setEditingUserId(null);
    }
  };

  const resetDropdownForm = () => {
    setEditingDropdownId(null);
    setDropdownForm({ value: '', label: '', sort_order: 0, is_active: true });
  };

  const saveDropdown = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (editingDropdownId) {
        await adminAPI.updateDropdownOption(editingDropdownId, {
          value: dropdownForm.value,
          label: dropdownForm.label || dropdownForm.value,
          sort_order: dropdownForm.sort_order,
          is_active: dropdownForm.is_active,
        });
        setMessage({ type: 'success', text: 'Dropdown option updated.' });
      } else {
        await adminAPI.createDropdownOption({
          category: dropdownCategory,
          value: dropdownForm.value,
          label: dropdownForm.label || dropdownForm.value,
          sort_order: dropdownForm.sort_order,
          is_active: dropdownForm.is_active,
        });
        setMessage({ type: 'success', text: 'Dropdown option added.' });
      }
      resetDropdownForm();
      await loadAdminData();
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to save dropdown option.') });
    } finally {
      setSaving(false);
    }
  };

  const editDropdown = (option: DropdownOption) => {
    setEditingDropdownId(option.option_id);
    setDropdownCategory(option.category as DropdownCategory);
    setDropdownForm({
      value: option.value,
      label: option.label || '',
      sort_order: option.sort_order,
      is_active: option.is_active,
    });
  };

  const resetReferenceForm = () => {
    setEditingReferenceId(null);
    setReferenceForm({
      location: '',
      structure_type: '',
      structure_name: '',
      structure_id: '',
      element_id: '',
    });
  };

  const saveReference = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        ...referenceForm,
        element_id: referenceForm.element_id || undefined,
      };
      if (editingReferenceId) {
        await adminAPI.updateReferenceElement(editingReferenceId, payload);
        setMessage({ type: 'success', text: 'Reference option updated.' });
      } else {
        await adminAPI.createReferenceElement(payload);
        setMessage({ type: 'success', text: 'Reference option added.' });
      }
      resetReferenceForm();
      await loadAdminData();
      if (referenceHasSearched) {
        await searchReferenceRows({ quiet: true });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to save reference option.') });
    } finally {
      setSaving(false);
    }
  };

  const editReference = (row: RequisitionElementOption) => {
    setEditingReferenceId(row.id);
    setReferenceForm({
      location: row.location,
      structure_type: row.structure_type,
      structure_name: row.structure_name,
      structure_id: row.structure_id,
      element_id: row.element_id || '',
    });
  };

  const removeInvite = async (inviteId: string) => {
    setSaving(true);
    try {
      await adminAPI.deleteRegistrationEmail(inviteId);
      await loadAdminData();
      setMessage({ type: 'success', text: 'Registration email removed.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to remove registration email.') });
    } finally {
      setSaving(false);
    }
  };

  const removeDropdown = async (optionId: string) => {
    setSaving(true);
    try {
      await adminAPI.deleteDropdownOption(optionId);
      await loadAdminData();
      setMessage({ type: 'success', text: 'Dropdown option removed.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to remove dropdown option.') });
    } finally {
      setSaving(false);
    }
  };

  const removeReference = async (rowId: number) => {
    setSaving(true);
    try {
      await adminAPI.deleteReferenceElement(rowId);
      await loadAdminData();
      if (referenceHasSearched) {
        await searchReferenceRows({ quiet: true });
      }
      setMessage({ type: 'success', text: 'Reference option removed.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to remove reference option.') });
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'access', label: 'Users & Access' },
    { id: 'dropdowns', label: 'Dropdowns' },
    { id: 'reference', label: 'Site Reference' },
  ];

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#134377]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-900">Administration</h1>
          <p className="text-sm text-gray-600">Control access and maintain the dropdown data used by site teams</p>
        </div>
        <button type="button" onClick={loadAdminData} className={secondaryButtonClass}>
          Refresh
        </button>
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${
              activeTab === tab.id
                ? 'bg-[#134377] text-white'
                : 'text-gray-700 hover:bg-blue-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['Users', summary.users, 'bg-blue-50 text-[#134377]'],
            ['Allowed Emails', summary.active_allowed_emails, 'bg-green-50 text-green-800'],
            ['Dropdown Options', summary.dropdown_options, 'bg-cyan-50 text-cyan-800'],
            ['Reference Rows', summary.reference_rows, 'bg-violet-50 text-violet-800'],
            ['Pending Ack.', summary.dispatches_pending_acknowledgement, 'bg-amber-50 text-amber-800'],
            ['Pending Return', summary.dispatches_pending_return, 'bg-orange-50 text-orange-800'],
            ['Pending Reqs.', summary.pending_requisitions, 'bg-yellow-50 text-yellow-800'],
            ['Approved Reqs.', summary.approved_requisitions, 'bg-emerald-50 text-emerald-800'],
            ['Planning Decisions', summary.planning_decisions, 'bg-slate-100 text-slate-700'],
          ].map(([label, value, tone]) => (
            <div key={label} className={`rounded-lg border border-gray-200 px-4 py-3 shadow-sm ${tone}`}>
              <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
              <p className="mt-1 text-3xl font-bold">{value}</p>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'access' && (
        <section className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#134377]">Approved Registration Emails</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_160px_120px_120px]">
              <input
                className={fieldClass}
                placeholder="Email allowed to register"
                disabled={Boolean(editingInviteId)}
                value={inviteForm.email}
                onChange={(event) => setInviteForm((form) => ({ ...form, email: event.target.value }))}
              />
              <input
                className={fieldClass}
                placeholder="Name hint"
                value={inviteForm.name_hint}
                onChange={(event) => setInviteForm((form) => ({ ...form, name_hint: event.target.value }))}
              />
              <Select
                classNames={selectClassNames}
                isMulti
                isSearchable
                placeholder="Assigned locations"
                options={locationOptions}
                value={selectedLocationOptions(inviteForm.assigned_locations)}
                onChange={(options) => {
                  const selected = options as readonly SelectOption[];
                  setInviteForm((form) => ({
                    ...form,
                    assigned_locations: selected.map((option) => option.value).join(', '),
                  }));
                }}
              />
              <select
                className={fieldClass}
                value={inviteForm.role}
                onChange={(event) => setInviteForm((form) => ({ ...form, role: event.target.value as UserRole }))}
              >
                {Object.values(UserRole).map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={inviteForm.is_active}
                  onChange={(event) => setInviteForm((form) => ({ ...form, is_active: event.target.checked }))}
                />
                Active
              </label>
              <button type="button" disabled={saving} onClick={saveInvite} className={primaryButtonClass}>
                {editingInviteId ? 'Update' : 'Add'}
              </button>
            </div>
            {editingInviteId && (
              <button type="button" onClick={resetInviteForm} className="mt-3 text-sm font-semibold text-[#134377]">
                Clear selected email
              </button>
            )}
          </div>

          <input
            className={fieldClass}
            placeholder="Search users or approved emails"
            value={accessSearch}
            onChange={(event) => setAccessSearch(event.target.value)}
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Registration List</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className={tableHeaderClass}>Email</th>
                      <th className={tableHeaderClass}>Role</th>
                      <th className={tableHeaderClass}>Locations</th>
                      <th className={tableHeaderClass}>Status</th>
                      <th className={tableHeaderClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => (
                      <tr key={invite.invite_id} className="border-t border-gray-100 hover:bg-blue-50/45">
                        <td className="px-4 py-3 text-sm">
                          <p className="font-semibold text-gray-900">{invite.email}</p>
                          <p className="text-xs text-gray-500">{invite.name_hint || '-'}</p>
                        </td>
                        <td className="px-4 py-3 text-sm">{invite.role}</td>
                        <td className="px-4 py-3 text-sm">{formatLocationList(invite.assigned_locations) || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            registeredEmailSet.has(invite.email.toLowerCase())
                              ? 'bg-green-100 text-green-800'
                              : invite.is_active
                                ? 'bg-blue-100 text-[#134377]'
                                : 'bg-gray-100 text-gray-600'
                          }`}>
                            {registeredEmailSet.has(invite.email.toLowerCase()) ? 'Registered' : invite.is_active ? 'Allowed' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button type="button" onClick={() => editInvite(invite)} className={secondaryButtonClass}>Edit</button>
                            <button type="button" disabled={saving} onClick={() => removeInvite(invite.invite_id)} className={dangerButtonClass}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Existing Users</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className={tableHeaderClass}>User</th>
                      <th className={tableHeaderClass}>Role</th>
                      <th className={tableHeaderClass}>Locations</th>
                      <th className={tableHeaderClass}>Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t border-gray-100 hover:bg-blue-50/45">
                        <td className="px-4 py-3 text-sm">
                          <p className="font-semibold text-gray-900">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={user.role}
                            disabled={editingUserId === user.id}
                            onChange={(event) => updateUserRole(user, event.target.value as UserRole)}
                            className={fieldClass}
                          >
                            {Object.values(UserRole).map((role) => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <div className="min-w-[240px] flex-1">
                              <Select
                                classNames={selectClassNames}
                                isMulti
                                isSearchable
                                isDisabled={editingUserId === user.id}
                                placeholder="Assigned locations"
                                options={locationOptions}
                                value={selectedLocationOptions(locationDrafts[user.id] || '')}
                                onChange={(options) => {
                                  const selected = options as readonly SelectOption[];
                                  setLocationDrafts((drafts) => ({
                                    ...drafts,
                                    [user.id]: selected.map((option) => option.value).join(', '),
                                  }));
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              disabled={editingUserId === user.id}
                              onClick={() => updateUserLocations(user)}
                              className={secondaryButtonClass}
                            >
                              Save
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">{user.is_email_verified ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'dropdowns' && (
        <section className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#134377]">Dropdown Data</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_1fr_1fr_110px_120px_120px]">
              <select
                className={fieldClass}
                value={dropdownCategory}
                onChange={(event) => setDropdownCategory(event.target.value as DropdownCategory)}
                disabled={Boolean(editingDropdownId)}
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className={fieldClass} placeholder="Value" value={dropdownForm.value} onChange={(event) => setDropdownForm((form) => ({ ...form, value: event.target.value }))} />
              <input className={fieldClass} placeholder="Display label" value={dropdownForm.label} onChange={(event) => setDropdownForm((form) => ({ ...form, label: event.target.value }))} />
              <input type="number" className={fieldClass} value={dropdownForm.sort_order} onChange={(event) => setDropdownForm((form) => ({ ...form, sort_order: Number(event.target.value) }))} />
              <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" checked={dropdownForm.is_active} onChange={(event) => setDropdownForm((form) => ({ ...form, is_active: event.target.checked }))} />
                Active
              </label>
              <button type="button" disabled={saving} onClick={saveDropdown} className={primaryButtonClass}>{editingDropdownId ? 'Update' : 'Add'}</button>
            </div>
            {editingDropdownId && (
              <button type="button" onClick={resetDropdownForm} className="mt-3 text-sm font-semibold text-[#134377]">
                Clear selected option
              </button>
            )}
          </div>

          <input className={fieldClass} placeholder="Search dropdown values" value={dropdownSearch} onChange={(event) => setDropdownSearch(event.target.value)} />

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px]">
              <thead className="bg-gray-100">
                <tr>
                  <th className={tableHeaderClass}>Dropdown</th>
                  <th className={tableHeaderClass}>Value</th>
                  <th className={tableHeaderClass}>Order</th>
                  <th className={tableHeaderClass}>Status</th>
                  <th className={tableHeaderClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dropdowns.map((option) => (
                  <tr key={option.option_id} className="border-t border-gray-100 hover:bg-blue-50/45">
                    <td className="px-4 py-3 text-sm">{categoryLabels[option.category as DropdownCategory] || option.category}</td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-semibold text-gray-900">{option.value}</p>
                      <p className="text-xs text-gray-500">{option.label || option.value}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{option.sort_order}</td>
                    <td className="px-4 py-3 text-sm">{option.is_active ? 'Active' : 'Hidden'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editDropdown(option)} className={secondaryButtonClass}>Edit</button>
                        <button type="button" disabled={saving} onClick={() => removeDropdown(option.option_id)} className={dangerButtonClass}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'reference' && (
        <section className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#134377]">Location / Structure Reference Data</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_120px]">
              <input className={fieldClass} placeholder="Location" value={referenceForm.location} onChange={(event) => setReferenceForm((form) => ({ ...form, location: event.target.value }))} />
              <input className={fieldClass} placeholder="Structure type" value={referenceForm.structure_type} onChange={(event) => setReferenceForm((form) => ({ ...form, structure_type: event.target.value }))} />
              <input className={fieldClass} placeholder="Structure name" value={referenceForm.structure_name} onChange={(event) => setReferenceForm((form) => ({ ...form, structure_name: event.target.value }))} />
              <input className={fieldClass} placeholder="Structure ID" value={referenceForm.structure_id} onChange={(event) => setReferenceForm((form) => ({ ...form, structure_id: event.target.value }))} />
              <input className={fieldClass} placeholder="Element ID" value={referenceForm.element_id || ''} onChange={(event) => setReferenceForm((form) => ({ ...form, element_id: event.target.value }))} />
              <button type="button" disabled={saving} onClick={saveReference} className={primaryButtonClass}>{editingReferenceId ? 'Update' : 'Add'}</button>
            </div>
            {editingReferenceId && (
              <button type="button" onClick={resetReferenceForm} className="mt-3 text-sm font-semibold text-[#134377]">
                Clear selected reference
              </button>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_120px_120px]">
              <input
                className={fieldClass}
                placeholder="Search location, structure, ID, or element"
                value={referenceSearch}
                onChange={(event) => {
                  referenceSearchRef.current = event.target.value;
                  setReferenceSearch(event.target.value);
                }}
              />
              <button
                type="button"
                onClick={() => searchReferenceRows()}
                disabled={referenceLoading}
                className={primaryButtonClass}
              >
                {referenceLoading ? 'Searching' : 'Search'}
              </button>
              <button
                type="button"
                onClick={clearReferenceSearch}
                disabled={referenceLoading}
                className={secondaryButtonClass}
              >
                Clear
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              {([
                ['location', 'Location'],
                ['structure_type', 'Structure Type'],
                ['structure_name', 'Structure Name'],
                ['structure_id', 'Structure ID'],
                ['element_id', 'Element ID'],
              ] as Array<[ReferenceSortField, string]>).map(([field, label]) => (
                <label key={field} className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</span>
                  <Select
                    classNames={selectClassNames}
                    isClearable
                    isSearchable
                    placeholder="All"
                    options={allReferenceFilterOptions[field]}
                    value={allReferenceFilterOptions[field].find((option) => option.value === referenceFilters[field]) || null}
                    onChange={(option) => {
                      const nextFilters = {
                        ...referenceFiltersRef.current,
                        [field]: option?.value || '',
                      };
                      referenceFiltersRef.current = nextFilters;
                      setReferenceFilters(nextFilters);
                    }}
                  />
                </label>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_120px]">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Sort By</span>
                <select
                  className={fieldClass}
                  value={referenceSort.field}
                  onChange={(event) =>
                    setReferenceSort((sort) => ({ ...sort, field: event.target.value as ReferenceSortField }))
                  }
                >
                  <option value="location">Location</option>
                  <option value="structure_type">Structure Type</option>
                  <option value="structure_name">Structure Name</option>
                  <option value="structure_id">Structure ID</option>
                  <option value="element_id">Element ID</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Direction</span>
                <select
                  className={fieldClass}
                  value={referenceSort.direction}
                  onChange={(event) =>
                    setReferenceSort((sort) => ({ ...sort, direction: event.target.value as 'asc' | 'desc' }))
                  }
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
              <div className="flex items-end text-sm font-semibold text-gray-600">
                {referenceHasSearched
                  ? `${filteredReferenceRows.length} result${filteredReferenceRows.length === 1 ? '' : 's'}`
                  : 'Choose filters, then search'}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px]">
              <thead className="bg-gray-100">
                <tr>
                  <th className={tableHeaderClass}>Location</th>
                  <th className={tableHeaderClass}>Structure Type</th>
                  <th className={tableHeaderClass}>Structure Name</th>
                  <th className={tableHeaderClass}>Structure ID</th>
                  <th className={tableHeaderClass}>Element ID</th>
                  <th className={tableHeaderClass}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReferenceRows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-blue-50/45">
                    <td className="px-4 py-3 text-sm">{row.location}</td>
                    <td className="px-4 py-3 text-sm">{row.structure_type}</td>
                    <td className="px-4 py-3 text-sm">{row.structure_name}</td>
                    <td className="px-4 py-3 text-sm">{row.structure_id}</td>
                    <td className="px-4 py-3 text-sm">{row.element_id || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editReference(row)} className={secondaryButtonClass}>Edit</button>
                        <button type="button" disabled={saving} onClick={() => removeReference(row.id)} className={dangerButtonClass}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {referenceHasSearched && filteredReferenceRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No reference rows match the selected search.
                    </td>
                  </tr>
                )}
                {!referenceHasSearched && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      Select one or more filters, then click Search to load matching site references.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default AdminView;

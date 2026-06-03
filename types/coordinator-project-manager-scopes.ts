export type CoordinatorScopeUserOption = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
};

export type CoordinatorProjectManagerScopeItem = {
  id: string;
  coordinatorId: string;
  projectManagerId?: string;
  createdById: string;
  createdAt: string;
  coordinator: CoordinatorScopeUserOption;
  projectManager: CoordinatorScopeUserOption;
};

export type CoordinatorProjectManagerScopesResponse = {
  scopes: CoordinatorProjectManagerScopeItem[];
  coordinators: CoordinatorScopeUserOption[];
  projectManagers: CoordinatorScopeUserOption[];
};

export type CreateCoordinatorProjectManagerScopeRequest = {
  coordinatorId: string;
  projectManagerId?: string;
};

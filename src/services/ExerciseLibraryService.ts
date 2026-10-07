import type { Exercise } from "../lib/types";
import { apiClient, type ApiClient } from "./ApiClient";
import { exerciseCatalog } from "../lib/catalog";
export interface LibraryFilters {
  search: string;
  muscle: string;
  equipment: string;
  page: number;
  language: string;
}
export interface LibraryPage {
  exercises: Exercise[];
  total: number;
  page: number;
  pageSize: number;
  catalogTotal: number;
  russianCount: number;
  release: string;
  fetchedAt: string;
  importing?: boolean;
  imported?: number;
}
export class ExerciseLibraryService {
  constructor(private client: ApiClient = apiClient) {}
  async find(filters: LibraryFilters, signal?: AbortSignal) {
    const query = new URLSearchParams({
      q: filters.search,
      muscle: filters.muscle,
      equipment: filters.equipment,
      page: String(filters.page),
      language: filters.language,
    });
    const result = await this.client.request<LibraryPage>(
      "/api/exercises?" + query,
      "GET",
      undefined,
      signal,
    );
    exerciseCatalog.register(result.exercises);
    return result;
  }
}
export const exerciseLibraryService = new ExerciseLibraryService();

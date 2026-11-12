import { apiClient } from "./ApiClient";
import type { Routine, ProductData, Exercise, MachineInstance } from "../lib/types";
export class ProductService {
  read(signal?: AbortSignal) {
    return apiClient.request<ProductData>(
      "/api/product",
      "GET",
      undefined,
      signal,
    );
  }
  saveMachine(machine: MachineInstance) { return apiClient.request<{ machine: MachineInstance }>("/api/machines", "PUT", machine); }
  archiveMachine(machine: MachineInstance) { return apiClient.request("/api/machines/" + encodeURIComponent(machine.id), "DELETE", { revision: machine.revision }); }
  saveRoutine(routine: Routine) {
    return apiClient.request<{ routine: Routine }>(
      "/api/routines",
      "PUT",
      routine,
    );
  }
  deleteRoutine(routine: Routine) {
    return apiClient.request(
      "/api/routines/" + encodeURIComponent(routine.id),
      "DELETE",
      { revision: routine.revision },
    );
  }
  saveExercise(input: unknown) {
    return apiClient.request<{ exercise: Exercise }>(
      "/api/custom-exercises",
      "PUT",
      input,
    );
  }
  deleteExercise(id: string) {
    return apiClient.request(
      "/api/custom-exercises/" + encodeURIComponent(id),
      "DELETE",
      {},
    );
  }
  favorite(exerciseId: string, favorite: boolean) {
    return apiClient.request("/api/favorites", "PUT", { exerciseId, favorite });
  }
}
export const productService = new ProductService();

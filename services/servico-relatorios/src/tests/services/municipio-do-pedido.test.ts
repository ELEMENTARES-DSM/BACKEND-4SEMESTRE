import { describe, it, expect, jest } from "@jest/globals";
import { existeEstacaoNoMunicipio } from "../../repositories/medicoes.repository";
import { ErroPedido, municipioDoPedido } from "../../services/municipio-do-pedido";

jest.mock("../../repositories/medicoes.repository");
const existeEstacao = jest.mocked(existeEstacaoNoMunicipio);

describe("US-31 · Cenário 4 · isolamento por município", () => {
  it("deve responder 404 quando o gestor pede outro município", async () => {
    // Dado
    const gestor = { papel: "GESTOR_PUBLICO", municipio: "São Paulo" };

    // Quando
    const pedido = municipioDoPedido(gestor, "São José dos Campos");

    // Então
    await expect(pedido).rejects.toEqual(new ErroPedido(404, "Município não encontrado."));
    expect(existeEstacao).not.toHaveBeenCalled();
  });

  it("deve usar o município do token quando o gestor não informa município", async () => {
    // Dado
    const gestor = { papel: "GESTOR_PUBLICO", municipio: "São Paulo" };
    existeEstacao.mockResolvedValue(true);

    // Quando
    const municipio = await municipioDoPedido(gestor);

    // Então
    expect(municipio).toBe("São Paulo");
  });

  it("deve responder 404 quando o município não tem estação cadastrada", async () => {
    // Dado
    const administrador = { papel: "ADMINISTRADOR", municipio: null };
    existeEstacao.mockResolvedValue(false);

    // Quando
    const pedido = municipioDoPedido(administrador, "Atlântida");

    // Então
    await expect(pedido).rejects.toEqual(new ErroPedido(404, "Município não encontrado."));
  });
});

describe("US-31 · município por perfil", () => {
  it("deve responder 400 quando o administrador não informa município e o token não tem", async () => {
    // Dado
    const administrador = { papel: "ADMINISTRADOR", municipio: null };

    // Quando
    const pedido = municipioDoPedido(administrador);

    // Então
    await expect(pedido).rejects.toEqual(new ErroPedido(400, "Informe o município."));
  });

  it.each(["ADMINISTRADOR", "PESQUISADOR", "MUNICIPE"])(
    "deve usar o município do pedido quando o perfil %s escolhe outro",
    async (papel) => {
      // Dado
      const usuario = { papel, municipio: "São Paulo" };
      existeEstacao.mockResolvedValue(true);

      // Quando
      const municipio = await municipioDoPedido(usuario, "Jacareí");

      // Então
      expect(municipio).toBe("Jacareí");
      expect(existeEstacao).toHaveBeenCalledWith("Jacareí");
    },
  );

  it("deve usar o município do token quando o munícipe não informa município", async () => {
    // Dado
    const municipe = { papel: "MUNICIPE", municipio: "Jacareí" };
    existeEstacao.mockResolvedValue(true);

    // Quando
    const municipio = await municipioDoPedido(municipe);

    // Então
    expect(municipio).toBe("Jacareí");
  });

  it("deve responder 403 quando o papel não é conhecido", async () => {
    // Dado
    const usuario = { papel: "VISITANTE", municipio: "Jacareí" };

    // Quando
    const pedido = municipioDoPedido(usuario);

    // Então
    await expect(pedido).rejects.toMatchObject({ status: 403 });
  });

  it("deve responder 403 quando o gestor não tem município no token", async () => {
    // Dado
    const gestor = { papel: "GESTOR_PUBLICO", municipio: null };

    // Quando
    const pedido = municipioDoPedido(gestor);

    // Então
    await expect(pedido).rejects.toEqual(new ErroPedido(403, "Gestor sem município associado."));
  });
});

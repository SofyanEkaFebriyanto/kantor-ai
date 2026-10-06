"""main.py — entry point kantor-ai: orchestrator loop + web UI."""
import logging
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import yaml  # noqa: E402

import agent as agent_mod      # noqa: E402
import llm as llm_mod          # noqa: E402
import orchestrator as orch_mod  # noqa: E402
import state as state_mod      # noqa: E402
import tools as tools_mod      # noqa: E402
import web as web_mod          # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))


def setup_logging(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    log_path = os.path.join(data_dir, "orchestrator.log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.FileHandler(log_path, encoding="utf-8"),
                  logging.StreamHandler(sys.stdout)],
    )
    return logging.getLogger("kantor-ai").info


def main():
    with open(os.path.join(BASE, "config.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    # env override untuk test lokal / VM
    if os.environ.get("KANTOR_DATA_DIR"):
        cfg["paths"]["data_dir"] = os.environ["KANTOR_DATA_DIR"]
    if os.environ.get("KANTOR_WORK_DIR"):
        cfg["paths"]["work_dir"] = os.environ["KANTOR_WORK_DIR"]
    tools_mod.WORK_DIR = cfg["paths"]["work_dir"]

    log = setup_logging(cfg["paths"]["data_dir"])
    db = state_mod.DB(os.path.join(cfg["paths"]["data_dir"], "office.db"))

    llm_cfg = cfg["llm"]
    base_url = os.environ.get("NINEROUTER_BASE_URL", llm_cfg["base_url"])

    def make_llm(model):
        return llm_mod.LLMClient(base_url, model,
                                 timeout_secs=llm_cfg.get("timeout_secs", 90),
                                 max_retries=llm_cfg.get("max_retries", 1))

    def runner_factory(name):
        return tools_mod.ToolRunner(db, name, log)

    names = [a["name"] for a in cfg["agents"]]
    db.set_agent_names(names)

    agents = []
    for a in cfg["agents"]:
        client = make_llm(a.get("model") or llm_cfg["default_model"])
        agents.append(agent_mod.Agent(a, client, db, runner_factory,
                                     cfg["paths"]["work_dir"], log))

    orch = orch_mod.Orchestrator(cfg, db, agents, make_llm, log)

    web_cfg = cfg.get("web", {})
    host = os.environ.get("KANTOR_WEB_HOST", web_cfg.get("host", "0.0.0.0"))
    port = int(os.environ.get("KANTOR_WEB_PORT", web_cfg.get("port", 8091)))
    t = threading.Thread(target=web_mod.run, args=(db, names, host, port), daemon=True)
    t.start()
    log(f"[web] UI di http://{host}:{port}")

    orch.run_forever()


if __name__ == "__main__":
    main()

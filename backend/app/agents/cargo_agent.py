from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI
import os

class CargoMonitoringAgent:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL_NAME", "gpt-4-turbo-preview"),
            api_key=os.getenv("OPENAI_API_KEY")
        )

    def get_agent(self):
        return Agent(
            role='Cargo Lifecycle Guardian',
            goal='Ensure cargo integrity and optimal environmental conditions during transit',
            backstory="""You are an expert in specialized cargo handling at SealFreight Nexus AI. 
            You specialize in cold-chain logistics, hazardous materials, and fragile electronics. 
            You monitor temperature, humidity, and handling impact to maintain cargo quality.""",
            verbose=True,
            allow_delegation=False,
            llm=self.llm
        )

    def create_monitoring_task(self, cargo_details, telemetry_data):
        return Task(
            description=f"""
            Analyze the condition of this cargo:
            Cargo: {cargo_details}
            Current Telemetry: {telemetry_data}
            
            Task: Verify if the cargo environment is within acceptable parameters.
            Check:
            1. Temperature stability for cold-chain items.
            2. Impact/Shock alerts for fragile goods.
            3. Humidity levels for specialized electronics.
            4. Compliance with hazardous material regulations.
            
            If parameters are breached, suggest immediate remedial actions for the driver.
            """,
            expected_output="A JSON object containing integrity_status, current_parameters, and remedial_actions.",
            agent=self.get_agent()
        )

    def run_monitoring(self, cargo_details, telemetry_data):
        task = self.create_monitoring_task(cargo_details, telemetry_data)
        crew = Crew(
            agents=[self.get_agent()],
            tasks=[task],
            process=Process.sequential
        )
        return crew.kickoff()
